// src/tools/artifact-search.ts
import { z } from "zod";
import { extractErrorMessage } from "@/utils/errors";
import { getArtifactIndex } from "./artifact-index";
import { defineTool } from "./define";

const DEFAULT_SEARCH_LIMIT = 10;

function formatSearchResult(result: {
  type: string;
  title?: string;
  id: string;
  filePath: string;
  summary?: string;
  score: number;
}): string {
  const typeLabel = result.type.charAt(0).toUpperCase() + result.type.slice(1);
  let out = `### ${typeLabel}: ${result.title || result.id}\n`;
  out += `**File:** \`${result.filePath}\`\n`;
  if (result.summary) {
    out += `**Summary:** ${result.summary}\n`;
  }
  out += `**Relevance Score:** ${result.score.toFixed(2)}\n\n`;
  return out;
}

export const artifact_search = defineTool({
  description: `Search past plans and ledgers for relevant precedent.
Use this to find:
- Similar problems you've solved before
- Patterns and approaches that worked
- Lessons learned from past sessions
Returns ranked results with file paths for further reading.`,
  args: {
    query: z.string().describe("Search query - describe what you're looking for"),
    limit: z.number().optional().describe("Max results to return (default: 10)"),
    type: z.enum(["all", "plan", "ledger"]).optional().describe("Filter by artifact type (default: all)"),
  },
  execute: async (args) => {
    try {
      const index = await getArtifactIndex();
      const results = await index.search(args.query, args.limit || DEFAULT_SEARCH_LIMIT);

      // Filter by type if specified
      const filtered = args.type && args.type !== "all" ? results.filter((r) => r.type === args.type) : results;

      if (filtered.length === 0) {
        return `No results found for "${args.query}". Try broader search terms.`;
      }

      let output = `## Search Results for "${args.query}"\n\n`;
      output += `Found ${filtered.length} result(s):\n\n`;

      for (const result of filtered) {
        output += formatSearchResult(result);
      }

      output += `---\n*Use the Read tool to view full content of relevant files.*`;

      return output;
    } catch (e) {
      return `Error searching artifacts: ${extractErrorMessage(e)}`;
    }
  },
});
