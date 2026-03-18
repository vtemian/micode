// src/hooks/fetch-tracker.ts
import type { PluginInput } from "@opencode-ai/plugin";

import { config } from "@/utils/config";
import { extractErrorMessage } from "@/utils/errors";
import { log } from "@/utils/logger";

// --- Tracked tools ---

export const FETCH_TOOLS = new Set(["webfetch", "context7_query-docs", "context7_resolve-library-id", "btca_ask"]);

// --- LRU Cache (factory pattern) ---

interface CacheEntry {
  readonly content: string;
  readonly timestamp: number;
}

interface LRUCache<V> {
  get(key: string): V | undefined;
  set(key: string, value: V): void;
  delete(key: string): void;
  clear(): void;
}

function createLRUCache<V>(maxSize: number): LRUCache<V> {
  const cache = new Map<string, V>();

  return {
    get(key: string): V | undefined {
      const value = cache.get(key);
      if (value === undefined) return undefined;
      // Move to end (most recently used)
      cache.delete(key);
      cache.set(key, value);
      return value;
    },

    set(key: string, value: V): void {
      if (cache.has(key)) {
        cache.delete(key);
      } else if (cache.size >= maxSize) {
        const firstKey = cache.keys().next().value;
        if (firstKey !== undefined) cache.delete(firstKey);
      }
      cache.set(key, value);
    },

    delete(key: string): void {
      cache.delete(key);
    },

    clear(): void {
      cache.clear();
    },
  };
}

// --- Per-session state ---

// Call counts: sessionID -> (normalizedKey -> count)
const sessionCallCounts = new Map<string, Map<string, number>>();

// Cache: sessionID -> LRUCache of fetch results
const sessionCaches = new Map<string, LRUCache<CacheEntry>>();

// --- Key normalization ---

/**
 * Normalize a tool call into a cache/tracking key.
 * Returns null if the tool is not tracked or args are missing/malformed.
 */
export function normalizeKey(tool: string, args: Record<string, unknown> | undefined): string | null {
  if (!FETCH_TOOLS.has(tool) || !args) return null;

  try {
    const normalizer = keyNormalizers[tool];
    return normalizer ? normalizer(args) : null;
  } catch (error) {
    log.warn("hooks.fetch-tracker", `Key normalization failed: ${extractErrorMessage(error)}`);
    return null;
  }
}

const keyNormalizers: Record<string, (args: Record<string, unknown>) => string | null> = {
  webfetch: (args) => normalizeWebfetchKey(args),
  "context7_query-docs": (args) => normalizeFieldPair(args, "context7_query-docs", "libraryId", "query"),
  "context7_resolve-library-id": (args) =>
    normalizeFieldPair(args, "context7_resolve-library-id", "libraryName", "query"),
  btca_ask: (args) => normalizeFieldPair(args, "btca_ask", "tech", "question"),
};

function normalizeWebfetchKey(args: Record<string, unknown>): string | null {
  const rawUrl = args.url as string | undefined;
  if (!rawUrl) return null;
  try {
    const parsed = new URL(rawUrl);
    parsed.searchParams.sort();
    return `webfetch|${parsed.toString()}`;
  } catch {
    return `webfetch|${rawUrl}`;
  }
}

function normalizeFieldPair(
  args: Record<string, unknown>,
  prefix: string,
  field1: string,
  field2: string,
): string | null {
  const val1 = args[field1] as string | undefined;
  const val2 = args[field2] as string | undefined;
  if (!val1 || !val2) return null;
  return `${prefix}|${val1}|${val2}`;
}

// --- Public accessors (for testing and external use) ---

export function getCallCount(sessionID: string, normalizedKey: string): number {
  return sessionCallCounts.get(sessionID)?.get(normalizedKey) ?? 0;
}

export function getCacheEntry(sessionID: string, normalizedKey: string): CacheEntry | undefined {
  return sessionCaches.get(sessionID)?.get(normalizedKey);
}

export function clearSession(sessionID: string): void {
  sessionCallCounts.delete(sessionID);
  sessionCaches.delete(sessionID);
}

// --- Internal helpers ---

function getOrCreateCounts(sessionID: string): Map<string, number> {
  let counts = sessionCallCounts.get(sessionID);
  if (!counts) {
    counts = new Map();
    sessionCallCounts.set(sessionID, counts);
  }
  return counts;
}

function getOrCreateCache(sessionID: string): LRUCache<CacheEntry> {
  let cache = sessionCaches.get(sessionID);
  if (!cache) {
    cache = createLRUCache<CacheEntry>(config.fetch.cacheMaxEntries);
    sessionCaches.set(sessionID, cache);
  }
  return cache;
}

function incrementCount(sessionID: string, key: string): number {
  const counts = getOrCreateCounts(sessionID);
  const current = counts.get(key) ?? 0;
  const next = current + 1;
  counts.set(key, next);
  return next;
}

function isCacheExpired(entry: CacheEntry): boolean {
  return Date.now() - entry.timestamp > config.fetch.cacheTtlMs;
}

// --- Hook factory ---

interface FetchTrackerHooks {
  "tool.execute.after": (
    input: { tool: string; sessionID: string; args?: Record<string, unknown> },
    output: { output?: string },
  ) => Promise<void>;
  event: (input: { event: { type: string; properties?: unknown } }) => Promise<void>;
  cleanupSession: (sessionID: string) => void;
}

export function createFetchTrackerHook(_ctx: PluginInput): FetchTrackerHooks {
  return {
    "tool.execute.after": async (input, output) => {
      try {
        handleFetchAfter(input, output);
      } catch (error) {
        log.warn("hooks.fetch-tracker", `After hook error: ${extractErrorMessage(error)}`);
      }
    },

    event: async ({ event }) => {
      if (event.type !== "session.deleted") return;
      const props = event.properties as { info?: { id?: string } } | undefined;
      if (props?.info?.id) clearSession(props.info.id);
    },

    cleanupSession: clearSession,
  };
}

// --- After-hook logic ---

function handleFetchAfter(
  input: { tool: string; sessionID: string; args?: Record<string, unknown> },
  output: { output?: string },
): void {
  if (!FETCH_TOOLS.has(input.tool)) return;

  const key = normalizeKey(input.tool, input.args);
  if (!key) return;

  const count = incrementCount(input.sessionID, key);

  if (count > config.fetch.maxCallsPerResource) {
    output.output = `<fetch-blocked>This resource has been fetched ${count} times this session. The content is already available in the conversation above. Use the information already available instead of re-fetching.</fetch-blocked>`;
    return;
  }

  const cache = getOrCreateCache(input.sessionID);
  const cached = cache.get(key);

  if (count > 1 && cached && !isCacheExpired(cached)) {
    output.output = buildCachedOutput(cached, count);
    return;
  }

  // First call or cache expired — store fresh result
  if (output.output) {
    cache.set(key, { content: output.output, timestamp: Date.now() });
  }
}

function buildCachedOutput(cached: CacheEntry, count: number): string {
  const plural = count !== 1 ? "s" : "";
  let cachedOutput = `<from-cache>Returning cached result (fetched ${count} time${plural} previously).</from-cache>\n\n${cached.content}`;

  if (count >= config.fetch.warnThreshold) {
    cachedOutput += `\n\n<fetch-warning>You have fetched this resource ${count} times. The content is cached and identical. Consider using the information you already have instead of re-fetching.</fetch-warning>`;
  }

  return cachedOutput;
}
