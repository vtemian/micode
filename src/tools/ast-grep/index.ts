import * as v from "valibot";
import { z } from "zod";
import type { Workspace } from "@/host/port";
import { defineTool, type MicodeTool } from "@/tools/define";
import { extractErrorMessage } from "@/utils/errors";
import { findExecutable, runCommand } from "@/utils/process";

/**
 * Check if ast-grep CLI (sg) is available on the system.
 * Returns installation instructions if not found.
 */
export async function checkAstGrepAvailable(): Promise<{ available: boolean; message?: string }> {
  if (await findAstGrep()) return { available: true };
  return { available: false, message: INSTALL_MESSAGE };
}

const LANGUAGES = [
  "c",
  "cpp",
  "csharp",
  "css",
  "dart",
  "elixir",
  "go",
  "haskell",
  "html",
  "java",
  "javascript",
  "json",
  "kotlin",
  "lua",
  "php",
  "python",
  "ruby",
  "rust",
  "scala",
  "sql",
  "swift",
  "tsx",
  "typescript",
  "yaml",
] as const;

const PositionSchema = v.object({
  line: v.number(),
  column: v.number(),
});

const RangeSchema = v.object({
  start: PositionSchema,
  end: PositionSchema,
});

const MatchSchema = v.object({
  file: v.string(),
  range: RangeSchema,
  text: v.string(),
  replacement: v.optional(v.string()),
});

const MatchArraySchema = v.array(MatchSchema);

interface Match {
  file: string;
  range: { start: { line: number; column: number }; end: { line: number; column: number } };
  text: string;
  replacement?: string;
}

export interface SgCall {
  readonly args: readonly string[];
  readonly cwd: string;
}

export interface SearchArgs {
  readonly pattern: string;
  readonly lang: string;
  readonly paths?: readonly string[];
}

export interface ReplaceArgs extends SearchArgs {
  readonly rewrite: string;
  readonly apply?: boolean;
}

const JSON_FLAG = "--json=compact";
const UPDATE_ALL_FLAG = "--update-all";
const PATHS_DESCRIPTION = "Paths to search, relative to the project directory (default: the project directory)";
const VERSION_TIMEOUT_MS = 1_000;
const INSTALL_MESSAGE =
  "ast-grep CLI not found. Install with:\n" +
  "  npm install -g @ast-grep/cli\n" +
  "  cargo install ast-grep --locked\n" +
  "  brew install ast-grep";

interface SgResult {
  matches: Match[];
  error?: string;
}

async function findAstGrep(): Promise<string | null> {
  const binary = findExecutable("ast-grep");
  if (binary) return binary;
  // On Linux, sg commonly belongs to util-linux rather than ast-grep.
  const alias = findExecutable("sg");
  if (!alias) return null;
  try {
    const { stdout, exitCode } = await runCommand(alias, ["--version"], { timeoutMs: VERSION_TIMEOUT_MS });
    return exitCode === 0 && stdout.startsWith("ast-grep ") ? alias : null;
  } catch {
    return null;
  }
}

function parseMatchOutput(stdout: string): SgResult {
  let raw: unknown;
  try {
    raw = JSON.parse(stdout);
  } catch {
    return { matches: [], error: "Failed to parse output" };
  }
  const result = v.safeParse(MatchArraySchema, raw);
  if (!result.success) {
    return { matches: [], error: "ast-grep output did not match expected schema" };
  }
  return { matches: result.output };
}

async function runSg(call: SgCall): Promise<SgResult> {
  const binary = await findAstGrep();
  if (!binary) return { matches: [], error: INSTALL_MESSAGE };
  try {
    const { stdout, stderr, exitCode } = await runCommand(binary, call.args, { cwd: call.cwd });

    const isNoFilesFound = exitCode !== 0 && !stdout.trim() && stderr.includes("No files found");
    if (isNoFilesFound) {
      return { matches: [] };
    }
    if (exitCode !== 0 && !stdout.trim()) {
      return { matches: [], error: stderr.trim() || `Exit code ${exitCode}` };
    }

    if (!stdout.trim()) return { matches: [] };

    return parseMatchOutput(stdout);
  } catch (error) {
    return { matches: [], error: extractErrorMessage(error) };
  }
}

const MAX_DISPLAY_MATCHES = 100;
const MAX_MATCH_TEXT_LENGTH = 100;

function formatMatches(matches: Match[], isDryRun = false): string {
  if (matches.length === 0) return "No matches found";

  const truncated = matches.length > MAX_DISPLAY_MATCHES;
  const shown = matches.slice(0, MAX_DISPLAY_MATCHES);

  const lines = shown.map((m) => {
    const loc = `${m.file}:${m.range.start.line}:${m.range.start.column}`;
    const text = m.text.length > MAX_MATCH_TEXT_LENGTH ? `${m.text.slice(0, MAX_MATCH_TEXT_LENGTH)}...` : m.text;
    if (isDryRun && m.replacement) {
      return `${loc}\n  - ${text}\n  + ${m.replacement}`;
    }
    return `${loc}: ${text}`;
  });

  if (truncated) {
    lines.unshift(`Found ${matches.length} matches (showing first ${MAX_DISPLAY_MATCHES}):`);
  }

  return lines.join("\n");
}

function targets(workspace: Workspace, paths: readonly string[] | undefined): string[] {
  return paths?.length ? [...paths] : [workspace.directory];
}

/** sg runs from the workspace so relative paths and the default target are the project micode was loaded for. */
export function searchCall(workspace: Workspace, args: SearchArgs): SgCall {
  return {
    cwd: workspace.directory,
    args: ["run", "-p", args.pattern, "--lang", args.lang, JSON_FLAG, ...targets(workspace, args.paths)],
  };
}

export function replaceCall(workspace: Workspace, args: ReplaceArgs): SgCall {
  const apply = args.apply ? [UPDATE_ALL_FLAG] : [];
  const rewrite = ["-r", args.rewrite, "--lang", args.lang, JSON_FLAG, ...apply];
  return { cwd: workspace.directory, args: ["run", "-p", args.pattern, ...rewrite, ...targets(workspace, args.paths)] };
}

function createSearchTool(workspace: Workspace): MicodeTool {
  return defineTool({
    description:
      "Search code patterns using AST-aware matching. " +
      "Use meta-variables: $VAR (single node), $$$ (multiple nodes). " +
      "Patterns must be complete AST nodes. " +
      "Examples: 'console.log($MSG)', 'def $FUNC($$$):', 'async function $NAME($$$)'",
    args: {
      pattern: z.string().describe("AST pattern with meta-variables"),
      lang: z.enum(LANGUAGES).describe("Target language"),
      paths: z.array(z.string()).optional().describe(PATHS_DESCRIPTION),
    },
    execute: async (args) => {
      const sgOutput = await runSg(searchCall(workspace, args));
      if (sgOutput.error) return `Error: ${sgOutput.error}`;
      return formatMatches(sgOutput.matches);
    },
  });
}

function describeReplacement(matches: Match[], apply: boolean | undefined): string {
  const output = formatMatches(matches, !apply);
  if (matches.length === 0) return output;
  if (apply) return `Applied ${matches.length} replacements:\n${output}`;
  return `${output}\n\n(Dry run - use apply=true to apply changes)`;
}

function createReplaceTool(workspace: Workspace): MicodeTool {
  return defineTool({
    description:
      "Replace code patterns with AST-aware rewriting. " +
      "Dry-run by default. Use meta-variables in rewrite to preserve matched content. " +
      "Example: pattern='console.log($MSG)' rewrite='logger.info($MSG)'",
    args: {
      pattern: z.string().describe("AST pattern to match"),
      rewrite: z.string().describe("Replacement pattern"),
      lang: z.enum(LANGUAGES).describe("Target language"),
      paths: z.array(z.string()).optional().describe(PATHS_DESCRIPTION),
      apply: z.boolean().optional().describe("Apply changes (default: false, dry-run)"),
    },
    execute: async (args) => {
      const sgOutput = await runSg(replaceCall(workspace, args));
      if (sgOutput.error) return `Error: ${sgOutput.error}`;
      return describeReplacement(sgOutput.matches, args.apply);
    },
  });
}

export interface AstGrepTools {
  readonly ast_grep_search: MicodeTool;
  readonly ast_grep_replace: MicodeTool;
}

export function createAstGrepTools(workspace: Workspace): AstGrepTools {
  return { ast_grep_search: createSearchTool(workspace), ast_grep_replace: createReplaceTool(workspace) };
}
