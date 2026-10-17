// src/tools/mindmodel-lookup.ts

import { z } from "zod";
import type { Workspace } from "@/host/port";
import { formatExamplesForInjection, type LoadedMindmodel, loadExamples, loadMindmodel } from "@/mindmodel";
import { extractErrorMessage } from "@/utils/errors";
import { log } from "@/utils/logger";
import { defineTool, type MicodeTools } from "./define";

const MAX_QUERY_LOG_LENGTH = 100;

let mindmodel: LoadedMindmodel | null | undefined;

async function getMindmodel(directory: string): Promise<LoadedMindmodel | null> {
  if (mindmodel === undefined) {
    mindmodel = await loadMindmodel(directory);
  }
  return mindmodel;
}

// Simple keyword-based category matching (no LLM needed)
export function matchCategories(query: string, manifest: LoadedMindmodel["manifest"]): string[] {
  const queryLower = query.toLowerCase();
  const matched: string[] = [];

  for (const category of manifest.categories) {
    // Extract keywords from path and description
    const pathParts = category.path.toLowerCase().replace(".md", "").split("/");
    const descLower = (category.description || "").toLowerCase();

    // Check if any keyword matches
    const keywords = [...pathParts, ...descLower.split(/\s+/)];
    const hasMatch = keywords.some((keyword) => keyword.length > 2 && queryLower.includes(keyword));
    if (hasMatch) {
      matched.push(category.path);
    }
  }

  return matched;
}

export function createMindmodelLookupTool(workspace: Workspace): MicodeTools {
  const mindmodel_lookup = defineTool({
    description: `Look up coding patterns and examples from the project's .mindmodel/ directory.
Call this tool when you need to understand how to implement something in this codebase.
Provide a brief description of what you're trying to do (e.g., "create a form component", "add error handling", "write a test").
Returns relevant code examples and patterns to follow.`,
    args: {
      query: z
        .string()
        .describe("What you're trying to implement (e.g., 'create a button component', 'add form validation')"),
    },
    execute: async ({ query }) => {
      try {
        const mindmodel = await getMindmodel(workspace.directory);
        if (!mindmodel) {
          return "No .mindmodel/ directory found in this project. Proceed without specific patterns.";
        }

        log.info("mindmodel", `Looking up patterns for: "${query.slice(0, MAX_QUERY_LOG_LENGTH)}..."`);

        // Match categories using keywords
        const categories = matchCategories(query, mindmodel.manifest);

        if (categories.length === 0) {
          return "No specific patterns found for this task. Proceed using general best practices.";
        }

        log.debug("mindmodel", `Matched categories: ${categories.join(", ")}`);

        // Load examples
        const examples = await loadExamples(mindmodel, categories);
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
