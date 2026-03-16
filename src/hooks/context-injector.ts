import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import type { PluginInput } from "@opencode-ai/plugin";

import { config } from "@/utils/config";

// Tools that trigger directory-aware context injection
const FILE_ACCESS_TOOLS = ["Read", "read", "Edit", "edit"];

// Cache for file contents
interface ContextCache {
  rootContent: Map<string, string>;
  directoryContent: Map<string, Map<string, string>>; // path -> filename -> content
  lastRootCheck: number;
}

interface ContextInjectorHooks {
  "chat.params": (
    _input: { sessionID: string },
    output: { options?: Record<string, unknown>; system?: string },
  ) => Promise<void>;
  "tool.execute.after": (
    input: { tool: string; args?: Record<string, unknown> },
    output: { output?: string },
  ) => Promise<void>;
}

export function createContextInjectorHook(ctx: PluginInput): ContextInjectorHooks {
  const cache: ContextCache = {
    rootContent: new Map(),
    directoryContent: new Map(),
    lastRootCheck: 0,
  };

  const loadRootContextFiles = (): Promise<Map<string, string>> => loadRootFiles(ctx, cache);
  const walkUpForContextFiles = (filePath: string): Promise<Map<string, string>> =>
    walkUpForContext(ctx, cache, filePath);

  return {
    "chat.params": async (_input, output) => {
      const files = await loadRootContextFiles();
      if (files.size === 0) return;
      const contextBlock = formatContextBlock(files, "project-context");
      output.system = output.system ? output.system + contextBlock : contextBlock;
    },

    "tool.execute.after": async (input, output) => {
      if (!FILE_ACCESS_TOOLS.includes(input.tool)) return;
      const filePath = input.args?.filePath as string | undefined;
      if (!filePath) return;
      try {
        const directoryFiles = await walkUpForContextFiles(filePath);
        if (directoryFiles.size === 0) return;
        const contextBlock = formatContextBlock(directoryFiles, "directory-context");
        if (output.output) {
          output.output = output.output + contextBlock;
        }
      } catch {
        // Ignore errors in context injection
      }
    },
  };
}

// --- Private helpers ---

async function loadRootFiles(ctx: PluginInput, cache: ContextCache): Promise<Map<string, string>> {
  const now = Date.now();
  if (now - cache.lastRootCheck < config.limits.contextCacheTtlMs && cache.rootContent.size > 0) {
    return cache.rootContent;
  }

  cache.rootContent.clear();
  cache.lastRootCheck = now;

  for (const filename of config.paths.rootContextFiles) {
    await tryLoadFile(join(ctx.directory, filename), filename, cache.rootContent);
  }

  return cache.rootContent;
}

async function tryLoadFile(filepath: string, key: string, target: Map<string, string>): Promise<void> {
  try {
    const content = await readFile(filepath, "utf-8");
    if (content.trim()) {
      target.set(key, content);
    }
  } catch {
    // File doesn't exist - skip
  }
}

async function walkUpForContext(ctx: PluginInput, cache: ContextCache, filePath: string): Promise<Map<string, string>> {
  const absPath = resolve(filePath);
  const projectRoot = resolve(ctx.directory);

  const cacheKey = dirname(absPath);
  const cached = cache.directoryContent.get(cacheKey);
  if (cached) return cached;

  const collected = new Map<string, string>();
  let currentDir = dirname(absPath);

  while (currentDir === projectRoot || currentDir.startsWith(`${projectRoot}/`)) {
    await collectDirContextFiles(currentDir, projectRoot, collected);
    if (currentDir === projectRoot) break;
    const parent = dirname(currentDir);
    if (parent === currentDir) break;
    currentDir = parent;
  }

  cache.directoryContent.set(cacheKey, collected);
  evictOldestIfNeeded(cache);

  return collected;
}

async function collectDirContextFiles(
  currentDir: string,
  projectRoot: string,
  collected: Map<string, string>,
): Promise<void> {
  for (const filename of config.paths.dirContextFiles) {
    const contextPath = join(currentDir, filename);
    const relPath = currentDir.replace(projectRoot, "").replace(/^\//, "") || ".";
    const key = `${relPath}/${filename}`;
    if (collected.has(key)) continue;
    await tryLoadFile(contextPath, key, collected);
  }
}

function evictOldestIfNeeded(cache: ContextCache): void {
  if (cache.directoryContent.size <= config.limits.contextCacheMaxSize) return;
  const firstKey = cache.directoryContent.keys().next().value;
  if (firstKey) cache.directoryContent.delete(firstKey);
}

function formatContextBlock(files: Map<string, string>, label: string): string {
  if (files.size === 0) return "";
  const blocks: string[] = [];
  for (const [filename, content] of files) {
    blocks.push(`<context file="${filename}">\n${content}\n</context>`);
  }
  return `\n<${label}>\n${blocks.join("\n\n")}\n</${label}>\n`;
}
