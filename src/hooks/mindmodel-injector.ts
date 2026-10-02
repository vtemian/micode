// src/hooks/mindmodel-injector.ts
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { PluginInput } from "@opencode-ai/plugin";

import {
  formatExamplesForInjection,
  type LoadedExample,
  type LoadedMindmodel,
  loadExamples,
  loadMindmodel,
} from "@/mindmodel";
import { matchCategories } from "@/tools/mindmodel-lookup";
import { config } from "@/utils/config";

const HASH_BIT_SHIFT = 5;
const BASE_36_RADIX = 36;
const TASK_CACHE_MAX_ENTRIES = 2000;

interface MessagePart {
  type: string;
  text?: string;
}

interface MessageWithParts {
  info: { role: string };
  parts: MessagePart[];
}

// Simple hash function for task strings
function hashTask(task: string): string {
  let hash = 0;
  for (let i = 0; i < task.length; i++) {
    const char = task.charCodeAt(i);
    hash = (hash << HASH_BIT_SHIFT) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return hash.toString(BASE_36_RADIX);
}

// Simple LRU cache for matched tasks
interface LRUCache<V> {
  get(key: string): V | undefined;
  set(key: string, value: V): void;
  has(key: string): boolean;
}

function createLRUCache<V>(maxSize: number): LRUCache<V> {
  const cache = new Map<string, V>();

  return {
    get(key: string): V | undefined {
      const value = cache.get(key);
      if (value !== undefined) {
        // Move to end (most recently used)
        cache.delete(key);
        cache.set(key, value);
      }
      return value;
    },

    set(key: string, value: V): void {
      if (cache.has(key)) {
        cache.delete(key);
      } else if (cache.size >= maxSize) {
        // Delete oldest (first) entry
        const firstKey = cache.keys().next().value;
        if (firstKey !== undefined) cache.delete(firstKey);
      }
      cache.set(key, value);
    },

    has(key: string): boolean {
      return cache.has(key);
    },
  };
}

function extractTaskFromMessages(messages: MessageWithParts[]): string {
  // Get the last user message
  const lastUserMessage = [...messages].reverse().find((m) => m.info.role === "user");
  if (!lastUserMessage) return "";

  // Extract text from parts
  return lastUserMessage.parts
    .filter((p) => p.type === "text" && p.text)
    .map((p) => p.text)
    .join(" ");
}

async function resolveInjection(
  task: string,
  mindmodel: LoadedMindmodel,
  matchedTasks: LRUCache<string>,
): Promise<string | null> {
  const taskHash = hashTask(task);
  const injection = matchedTasks.get(taskHash);
  if (injection !== undefined) {
    return injection || null;
  }

  const all = await loadExamples(
    mindmodel,
    mindmodel.manifest.categories.map((category) => category.path),
  );
  const byPath = new Map(all.map((example) => [example.path, example]));

  const categories = matchCategories(task, mindmodel.manifest, byPath);
  if (categories.length === 0) {
    matchedTasks.set(taskHash, "");
    return null;
  }

  const examples = categories
    .map((path) => byPath.get(path))
    .filter((example): example is LoadedExample => example !== undefined);
  if (examples.length === 0) {
    matchedTasks.set(taskHash, "");
    return null;
  }

  const formatted = formatExamplesForInjection(examples);
  matchedTasks.set(taskHash, formatted);
  return formatted;
}

async function loadSystemMd(directory: string): Promise<string | null> {
  try {
    const systemPath = join(directory, config.paths.mindmodelDir, config.paths.mindmodelSystem);
    return await readFile(systemPath, "utf-8");
  } catch {
    return null;
  }
}

function createCachedLoader<T>(loader: () => Promise<T | null>): () => Promise<T | null> {
  let cached: T | null | undefined;
  return async () => {
    if (cached === undefined) cached = await loader();
    return cached;
  };
}

interface MindmodelInjectorHooks {
  "experimental.chat.messages.transform": (
    _input: Record<string, unknown>,
    output: { messages: MessageWithParts[] },
  ) => Promise<void>;
  "experimental.chat.system.transform": (_input: { sessionID: string }, output: { system: string[] }) => Promise<void>;
}

export function createMindmodelInjectorHook(ctx: PluginInput): MindmodelInjectorHooks {
  let pendingInjection: string | null = null;
  const matchedTasks = createLRUCache<string>(TASK_CACHE_MAX_ENTRIES);
  const getMindmodel = createCachedLoader(() => loadMindmodel(ctx.directory));
  const getSystemMd = createCachedLoader(() => loadSystemMd(ctx.directory));

  return {
    "experimental.chat.messages.transform": async (
      _input: Record<string, unknown>,
      output: { messages: MessageWithParts[] },
    ) => {
      try {
        const mindmodel = await getMindmodel();
        if (!mindmodel) return;
        const task = extractTaskFromMessages(output.messages);
        if (!task) return;
        pendingInjection = await resolveInjection(task, mindmodel, matchedTasks);
      } catch {
        // Silently ignore errors - don't break the main flow
      }
    },

    "experimental.chat.system.transform": async (_input: { sessionID: string }, output: { system: string[] }) => {
      const systemMd = await getSystemMd();
      if (systemMd) {
        output.system.unshift(`<mindmodel-constraints>\n${systemMd}\n</mindmodel-constraints>`);
      }
      if (pendingInjection) {
        const injection = pendingInjection;
        pendingInjection = null;
        output.system.unshift(injection);
      }
    },
  };
}
