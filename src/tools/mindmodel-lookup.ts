// src/tools/mindmodel-lookup.ts
import type { PluginInput, ToolDefinition } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin/tool";

import {
  formatExamplesForInjection,
  type LoadedExample,
  type LoadedMindmodel,
  loadExamples,
  loadMindmodel,
} from "@/mindmodel";
import { extractErrorMessage } from "@/utils/errors";
import { log } from "@/utils/logger";

const MAX_QUERY_LOG_LENGTH = 100;

/**
 * Every category file, read once and kept.
 *
 * Matching needs the headings inside each file, and both callers match and then
 * load — so the read has to happen first either way, and doing it once keeps
 * matching and loading in agreement about what exists.
 */
async function loadAllExamples(mindmodel: LoadedMindmodel): Promise<Map<string, LoadedExample>> {
  const examples = await loadExamples(
    mindmodel,
    mindmodel.manifest.categories.map((category) => category.path),
  );
  return new Map(examples.map((example) => [example.path, example]));
}

let mindmodel: LoadedMindmodel | null | undefined;
let examplesByPath: Map<string, LoadedExample> | undefined;

async function getMindmodel(directory: string): Promise<LoadedMindmodel | null> {
  if (mindmodel === undefined) {
    mindmodel = await loadMindmodel(directory);
    examplesByPath = mindmodel ? await loadAllExamples(mindmodel) : new Map();
  }
  return mindmodel;
}

/** Words shorter than this are too common to be evidence of anything. */
const MIN_KEYWORD_LENGTH = 3;

/**
 * Split text into comparable words.
 *
 * Markdown and prose are punctuated, and the interesting words are almost never
 * the ones glued to a bracket or a backtick, so punctuation is stripped rather
 * than searched through.
 */
function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= MIN_KEYWORD_LENGTH);
}

/**
 * Simple keyword-based category matching (no LLM needed).
 *
 * Matches a category on any word shared with the query, in either direction:
 * the query may name a file's word ("sibling-projects"), or a file may name the
 * query's ("hard rules" is a heading inside `constraints.md`). Requiring
 * `query.includes(keyword)` only ever tested the first direction, which is why a
 * query naming a section found nothing.
 */
export function matchCategories(
  query: string,
  manifest: LoadedMindmodel["manifest"],
  examples: ReadonlyMap<string, LoadedExample> = new Map(),
): string[] {
  const queryWords = new Set(words(query));
  const matched: string[] = [];

  for (const category of manifest.categories) {
    const pathWords = words(category.path.replace(/\.md$/, ""));
    const descriptionWords = words(category.description ?? "");
    const headingWords = (examples.get(category.path)?.headings ?? []).flatMap(words);

    const haystack = new Set([...pathWords, ...descriptionWords, ...headingWords]);
    if ([...queryWords].some((word) => haystack.has(word))) {
      matched.push(category.path);
    }
  }

  return matched;
}

export function createMindmodelLookupTool(ctx: PluginInput): { mindmodel_lookup: ToolDefinition } {
  const mindmodel_lookup = tool({
    description: `Look up coding patterns and examples from the project's .mindmodel/ directory.
Call this tool when you need to understand how to implement something in this codebase.
Provide a brief description of what you're trying to do (e.g., "create a form component", "add error handling", "write a test").
Returns relevant code examples and patterns to follow.`,
    args: {
      query: tool.schema
        .string()
        .describe("What you're trying to implement (e.g., 'create a button component', 'add form validation')"),
    },
    execute: async ({ query }) => {
      try {
        const mindmodel = await getMindmodel(ctx.directory);
        if (!mindmodel) {
          // Say what was looked for. "No .mindmodel/ directory found" was also
          // returned when the directory existed but could not be read, which
          // tells the model to carry on without constraints while constraint
          // files sit unread on disk.
          return "No usable .mindmodel/ found in this project (no manifest.yaml and no readable markdown files). Proceed without specific patterns.";
        }

        log.info("mindmodel", `Looking up patterns for: "${query.slice(0, MAX_QUERY_LOG_LENGTH)}..."`);

        const categories = matchCategories(query, mindmodel.manifest, examplesByPath);

        if (categories.length === 0) {
          return "No specific patterns found for this task. Proceed using general best practices.";
        }

        log.debug("mindmodel", `Matched categories: ${categories.join(", ")}`);

        const examples = categories
          .map((path) => examplesByPath?.get(path))
          .filter((example): example is LoadedExample => example !== undefined);

        if (examples.length === 0) {
          return "Categories matched but no examples found. Proceed using general best practices.";
        }

        const formatted = formatExamplesForInjection(examples);
        log.debug("mindmodel", `Returning ${examples.length} examples`);

        return formatted;
      } catch (error) {
        log.warn("mindmodel", `Lookup failed: ${extractErrorMessage(error)}`);
        return "Failed to load patterns. Proceed using general best practices.";
      }
    },
  });

  return { mindmodel_lookup };
}
