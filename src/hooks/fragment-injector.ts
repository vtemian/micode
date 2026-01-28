// src/hooks/fragment-injector.ts
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Load project-level fragments from .micode/fragments.json
 * Returns empty object if file doesn't exist or is invalid
 */
export async function loadProjectFragments(projectDir: string): Promise<Record<string, string[]>> {
  const fragmentsPath = join(projectDir, ".micode", "fragments.json");

  try {
    const content = await readFile(fragmentsPath, "utf-8");
    const parsed = JSON.parse(content) as Record<string, unknown>;

    const fragments: Record<string, string[]> = {};

    for (const [agentName, fragmentList] of Object.entries(parsed)) {
      if (Array.isArray(fragmentList)) {
        const validFragments = fragmentList.filter((f): f is string => typeof f === "string" && f.trim().length > 0);
        if (validFragments.length > 0) {
          fragments[agentName] = validFragments;
        }
      }
    }

    return fragments;
  } catch {
    return {};
  }
}

/**
 * Merge global and project fragments
 * Global fragments come first, project fragments are appended
 */
export function mergeFragments(
  global: Record<string, string[]>,
  project: Record<string, string[]>,
): Record<string, string[]> {
  const allAgents = new Set([...Object.keys(global), ...Object.keys(project)]);
  const merged: Record<string, string[]> = {};

  for (const agent of allAgents) {
    const globalFragments = global[agent] ?? [];
    const projectFragments = project[agent] ?? [];
    const combined = [...globalFragments, ...projectFragments];

    if (combined.length > 0) {
      merged[agent] = combined;
    }
  }

  return merged;
}
