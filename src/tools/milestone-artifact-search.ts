import { z } from "zod";
import { extractErrorMessage } from "@/utils/errors";
import { getArtifactIndex } from "./artifact-index";
import { defineTool } from "./define";

const ARTIFACT_TYPES = ["feature", "decision", "session"] as const;

export const milestone_artifact_search = defineTool({
  description: `Search milestone-driven artifacts stored in SQLite.
Use this to find feature, decision, or session artifacts for a specific milestone.
Returns ranked results filtered by milestone metadata.`,
  args: {
    query: z.string().describe("Search query for milestone artifacts"),
    milestone_id: z.string().optional().describe("Optional milestone identifier to filter results"),
    artifact_type: z.enum(ARTIFACT_TYPES).optional().describe("Optional artifact type to filter results"),
    limit: z.number().optional().describe("Max results to return (default: 10)"),
  },
  execute: async (args) => {
    try {
      const index = await getArtifactIndex();
      const results = await index.searchMilestoneArtifacts(args.query, {
        milestoneId: args.milestone_id,
        artifactType: args.artifact_type,
        limit: args.limit,
      });

      if (results.length === 0) {
        return "No milestone artifact results found for that query.";
      }

      let output = `## Milestone Artifact Search Results\n\nFound ${results.length} result(s).\n\n`;

      for (const result of results) {
        const tags = result.tags.length ? result.tags.join(", ") : "none";
        output += `### ${result.milestoneId} · ${result.artifactType}\n`;
        output += `- ID: ${result.id}\n`;
        output += `- Source Session: ${result.sourceSessionId ?? "unknown"}\n`;
        output += `- Created: ${result.createdAt ?? "unknown"}\n`;
        output += `- Tags: ${tags}\n`;
        output += `- Payload: ${result.payload}\n`;
        output += `- Score: ${result.score.toFixed(2)}\n\n`;
      }

      return output;
    } catch (error) {
      return `Error searching milestone artifacts: ${extractErrorMessage(error)}`;
    }
  },
});
