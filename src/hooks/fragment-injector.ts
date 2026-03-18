// src/hooks/fragment-injector.ts
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { PluginInput } from "@opencode-ai/plugin";
import * as v from "valibot";

import type { MicodeConfig } from "@/config-loader";

/**
 * Schema for a project fragments file: Record<string, string[]>
 * Uses record of unknown values to allow graceful per-key validation.
 */
const ProjectFragmentsSchema = v.record(v.string(), v.unknown());

/**
 * Extract valid string fragments from an unknown value
 */
function extractValidFragments(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const valid = value.filter((f): f is string => typeof f === "string" && f.trim().length > 0);
  return valid.length > 0 ? valid : null;
}

/**
 * Parse a raw fragments object into validated Record<string, string[]>
 */
function parseFragments(raw: unknown): Record<string, string[]> {
  const parsed = v.safeParse(ProjectFragmentsSchema, raw);
  if (!parsed.success) return {};

  const result: Record<string, string[]> = {};
  for (const [agentName, fragments] of Object.entries(parsed.output)) {
    const valid = extractValidFragments(fragments);
    if (valid) result[agentName] = valid;
  }
  return result;
}

/**
 * Load project-level fragments from .micode/fragments.json
 * Returns empty object if file doesn't exist or is invalid
 */
export async function loadProjectFragments(projectDir: string): Promise<Record<string, string[]>> {
  const fragmentsPath = join(projectDir, ".micode", "fragments.json");

  try {
    const content = await readFile(fragmentsPath, "utf-8");
    const raw: unknown = JSON.parse(content);
    return parseFragments(raw);
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
  const agents = new Set([...Object.keys(global), ...Object.keys(project)]);
  const merged: Record<string, string[]> = {};

  for (const agent of agents) {
    const globalFragments = global[agent] ?? [];
    const projectFragments = project[agent] ?? [];
    const combined = [...globalFragments, ...projectFragments];

    if (combined.length > 0) {
      merged[agent] = combined;
    }
  }

  return merged;
}

/**
 * Format fragments as an XML block for injection into system prompt
 */
export function formatFragmentsBlock(fragments: string[]): string {
  if (fragments.length === 0) {
    return "";
  }

  const bullets = fragments.map((f) => `- ${f}`).join("\n");
  return `<user-instructions>\n${bullets}\n</user-instructions>\n\n`;
}

/**
 * Initialize Levenshtein distance matrix
 */
function initLevenshteinMatrix(aLen: number, bLen: number): number[][] {
  const matrix: number[][] = [];
  for (let i = 0; i <= bLen; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= aLen; j++) {
    matrix[0][j] = j;
  }
  return matrix;
}

/**
 * Fill a single row of the Levenshtein matrix
 */
function fillLevenshteinRow(matrix: number[][], a: string, bChar: string, i: number): void {
  for (let j = 1; j <= a.length; j++) {
    const cost = bChar === a.charAt(j - 1) ? 0 : 1;
    matrix[i][j] =
      cost === 0
        ? matrix[i - 1][j - 1]
        : Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1);
  }
}

/**
 * Simple Levenshtein distance for typo detection
 */
function levenshteinDistance(a: string, b: string): number {
  const matrix = initLevenshteinMatrix(a.length, b.length);

  for (let i = 1; i <= b.length; i++) {
    fillLevenshteinRow(matrix, a, b.charAt(i - 1), i);
  }

  return matrix[b.length][a.length];
}

/**
 * Find closest matching agent name
 */
function findClosestAgent(unknown: string, knownAgents: Set<string>): string | null {
  let closest: string | null = null;
  let minDistance = Infinity;

  for (const known of knownAgents) {
    const distance = levenshteinDistance(unknown, known);
    // Only suggest if distance is reasonable (less than half the length)
    if (distance < minDistance && distance <= Math.ceil(known.length / 2)) {
      minDistance = distance;
      closest = known;
    }
  }

  return closest;
}

/**
 * Generate warnings for unknown agent names in fragments config
 */
export function warnUnknownAgents(fragmentAgents: string[], knownAgents: Set<string>): string[] {
  const warnings: string[] = [];

  for (const agent of fragmentAgents) {
    if (knownAgents.has(agent)) continue;

    const closest = findClosestAgent(agent, knownAgents);
    const suffix = closest ? ` Did you mean "${closest}"?` : "";
    warnings.push(`[micode] Unknown agent "${agent}" in fragments config.${suffix}`);
  }

  return warnings;
}

/**
 * Create fragment injector hook
 * Injects user-defined fragments at the beginning of agent system prompts
 */
interface FragmentInjectorHooks {
  "chat.params": (
    _input: { sessionID: string },
    output: { options?: Record<string, unknown>; system?: string },
  ) => Promise<void>;
}

export function createFragmentInjectorHook(ctx: PluginInput, globalConfig: MicodeConfig | null): FragmentInjectorHooks {
  // Cache for project fragments (loaded once per session)
  let projectFragmentsCache: Record<string, string[]> | null = null;

  async function getProjectFragments(): Promise<Record<string, string[]>> {
    if (projectFragmentsCache === null) {
      projectFragmentsCache = await loadProjectFragments(ctx.directory);
    }
    return projectFragmentsCache;
  }

  return {
    "chat.params": async (
      _input: { sessionID: string },
      output: { options?: Record<string, unknown>; system?: string },
    ) => {
      const agent = output.options?.agent as string | undefined;
      if (!agent) return;

      const globalFragments = globalConfig?.fragments ?? {};
      const projectFragments = await getProjectFragments();
      const mergedFragments = mergeFragments(globalFragments, projectFragments);

      const agentFragments = mergedFragments[agent];
      if (!agentFragments || agentFragments.length === 0) return;

      const fragmentBlock = formatFragmentsBlock(agentFragments);

      if (output.system) {
        output.system = fragmentBlock + output.system;
      } else {
        output.system = fragmentBlock;
      }
    },
  };
}
