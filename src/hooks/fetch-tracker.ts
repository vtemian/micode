// src/hooks/fetch-tracker.ts
import type { PluginInput } from "@opencode-ai/plugin";

import { config } from "../utils/config";
import { log } from "../utils/logger";

// --- Tracked tools ---

export const FETCH_TOOLS = new Set(["webfetch", "context7_query-docs", "context7_resolve-library-id", "btca_ask"]);

// --- LRU Cache (same pattern as mindmodel-injector.ts) ---

interface CacheEntry {
  content: string;
  timestamp: number;
}

class LRUCache<V> {
  private cache = new Map<string, V>();
  constructor(private maxSize: number) {}

  get(key: string): V | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      // Move to end (most recently used)
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }

  set(key: string, value: V): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // Delete oldest (first) entry
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) this.cache.delete(firstKey);
    }
    this.cache.set(key, value);
  }

  delete(key: string): void {
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }
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
    switch (tool) {
      case "webfetch": {
        const rawUrl = args.url as string | undefined;
        if (!rawUrl) return null;
        try {
          const parsed = new URL(rawUrl);
          // Sort query params for consistent keys
          parsed.searchParams.sort();
          return `webfetch|${parsed.toString()}`;
        } catch {
          // Malformed URL — use raw string as fallback
          return `webfetch|${rawUrl}`;
        }
      }
      case "context7_query-docs": {
        const libraryId = args.libraryId as string | undefined;
        const query = args.query as string | undefined;
        if (!libraryId || !query) return null;
        return `context7_query-docs|${libraryId}|${query}`;
      }
      case "context7_resolve-library-id": {
        const libraryName = args.libraryName as string | undefined;
        const query = args.query as string | undefined;
        if (!libraryName || !query) return null;
        return `context7_resolve-library-id|${libraryName}|${query}`;
      }
      case "btca_ask": {
        const tech = args.tech as string | undefined;
        const question = args.question as string | undefined;
        if (!tech || !question) return null;
        return `btca_ask|${tech}|${question}`;
      }
      default:
        return null;
    }
  } catch (error) {
    log.warn("hooks.fetch-tracker", `Key normalization failed: ${error instanceof Error ? error.message : "unknown"}`);
    return null;
  }
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
    cache = new LRUCache<CacheEntry>(config.fetch.cacheMaxEntries);
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

export function createFetchTrackerHook(_ctx: PluginInput) {
  return {
    /**
     * After hook: track fetch calls, cache results, inject warnings/blocks.
     *
     * On first call: stores result in cache, increments count.
     * On repeated calls: replaces output with cached content + warning.
     * After maxCallsPerResource: replaces output with block message.
     *
     * Note: We use tool.execute.after (not before) because the plugin SDK's
     * before hook only exposes { args } for modification, not { output }.
     * The after hook can mutate output.output to replace the tool's result.
     */
    "tool.execute.after": async (
      input: { tool: string; sessionID: string; args?: Record<string, unknown> },
      output: { output?: string },
    ) => {
      try {
        if (!FETCH_TOOLS.has(input.tool)) return;

        const key = normalizeKey(input.tool, input.args);
        if (!key) return;

        // Increment call count
        const count = incrementCount(input.sessionID, key);

        // Hard block: exceeded max calls — unconditional, independent of cache state
        if (count > config.fetch.maxCallsPerResource) {
          output.output = `<fetch-blocked>This resource has been fetched ${count} times this session. The content is already available in the conversation above. Use the information already available instead of re-fetching.</fetch-blocked>`;
          return;
        }

        // Check for cached content from a previous call
        const cache = getOrCreateCache(input.sessionID);
        const cached = cache.get(key);

        if (count > 1 && cached && !isCacheExpired(cached)) {
          // Repeated call with valid cache — replace output with cached content
          let cachedOutput = `<from-cache>Returning cached result (fetched ${count} time${count !== 1 ? "s" : ""} previously).</from-cache>\n\n${cached.content}`;

          // Add warning if at or above warn threshold
          if (count >= config.fetch.warnThreshold) {
            cachedOutput += `\n\n<fetch-warning>You have fetched this resource ${count} times. The content is cached and identical. Consider using the information you already have instead of re-fetching.</fetch-warning>`;
          }

          output.output = cachedOutput;
        } else {
          // First call or cache expired — store fresh result
          if (output.output) {
            cache.set(key, { content: output.output, timestamp: Date.now() });
          }
        }
      } catch (error) {
        log.warn("hooks.fetch-tracker", `After hook error: ${error instanceof Error ? error.message : "unknown"}`);
      }
    },

    /**
     * Event handler: clean up on session deletion.
     * Same pattern as file-ops-tracker.
     */
    event: async ({ event }: { event: { type: string; properties?: unknown } }) => {
      if (event.type === "session.deleted") {
        const props = event.properties as { info?: { id?: string } } | undefined;
        if (props?.info?.id) {
          clearSession(props.info.id);
        }
      }
    },

    /** Direct cleanup function (used by index.ts for explicit cleanup) */
    cleanupSession: clearSession,
  };
}
