// src/hooks/artifact-auto-index.ts
// Auto-indexes artifacts when written to thoughts/ directories

import { readFileSync } from "node:fs";
import { getArtifactIndex } from "@/tools/artifact-index";
import { log } from "@/utils/logger";

const LEDGER_PATH_PATTERN = /thoughts\/ledgers\/CONTINUITY_(.+)\.md$/;
const PLAN_PATH_PATTERN = /thoughts\/shared\/plans\/(.+)\.md$/;
/** gpt models write through the patch tool (`apply_patch` on v1, `patch` on v2) instead of write. */
const INDEXED_TOOLS: readonly string[] = ["write", "patch", "apply_patch"];

export function parseLedger(
  content: string,
  filePath: string,
  sessionName: string,
): {
  id: string;
  sessionName: string;
  filePath: string;
  goal: string;
  stateNow: string;
  keyDecisions: string;
  filesRead: string;
  filesModified: string;
} {
  const goalMatch = content.match(/## Goal\n([^\n]+)/);
  const stateMatch = content.match(/### In Progress\n- \[ \] ([^\n]+)/);
  const decisionsMatch = content.match(/## Key Decisions\n([\s\S]*?)(?=\n## |$)/);

  const { filesRead, filesModified } = parseFileOperations(content);

  return {
    id: `ledger-${sessionName}`,
    sessionName,
    filePath,
    goal: goalMatch?.[1] || "",
    stateNow: stateMatch?.[1] || "",
    keyDecisions: decisionsMatch?.[1]?.trim() || "",
    filesRead,
    filesModified,
  };
}

function parseFileOperations(content: string): { filesRead: string; filesModified: string } {
  const fileOpsSection = content.match(/## File Operations\n([\s\S]*?)(?=\n## |$)/);
  if (!fileOpsSection) return { filesRead: "", filesModified: "" };

  const readMatch = fileOpsSection[1].match(/### Read\n([\s\S]*?)(?=\n### |$)/);
  const modifiedMatch = fileOpsSection[1].match(/### Modified\n([\s\S]*?)(?=\n### |$)/);

  return {
    filesRead: extractBacktickedPaths(readMatch?.[1]),
    filesModified: extractBacktickedPaths(modifiedMatch?.[1]),
  };
}

function extractBacktickedPaths(section: string | undefined): string {
  if (!section) return "";
  const paths = section.match(/`([^`]+)`/g);
  return paths ? paths.map((p) => p.replace(/`/g, "")).join(",") : "";
}

function parsePlan(
  content: string,
  filePath: string,
  fileName: string,
): {
  id: string;
  title: string;
  filePath: string;
  overview: string;
  approach: string;
} {
  // Extract title (first heading)
  const titleMatch = content.match(/^# (.+)$/m);
  const title = titleMatch?.[1] || fileName;

  // Extract overview
  const overviewMatch = content.match(/## Overview\n\n([\s\S]*?)(?=\n## |$)/);
  const overview = overviewMatch?.[1]?.trim() || "";

  // Extract approach
  const approachMatch = content.match(/## Approach\n\n([\s\S]*?)(?=\n## |$)/);
  const approach = approachMatch?.[1]?.trim() || "";

  return {
    id: `plan-${fileName}`,
    title,
    filePath,
    overview,
    approach,
  };
}

interface ArtifactAutoIndexHooks {
  "tool.execute.after": (
    input: { tool: string; args?: Record<string, unknown> },
    _output: { output?: string },
  ) => Promise<void>;
}

export function createArtifactAutoIndexHook(): ArtifactAutoIndexHooks {
  return {
    "tool.execute.after": async (
      input: { tool: string; args?: Record<string, unknown> },
      _output: { output?: string },
    ) => {
      if (!INDEXED_TOOLS.includes(input.tool)) return;

      const filePath = input.args?.filePath as string | undefined;
      if (!filePath) return;

      try {
        // Check if it's a ledger
        const ledgerMatch = filePath.match(LEDGER_PATH_PATTERN);
        if (ledgerMatch) {
          const content = readFileSync(filePath, "utf-8");
          const index = await getArtifactIndex();
          const record = parseLedger(content, filePath, ledgerMatch[1]);
          await index.indexLedger(record);
          return;
        }

        // Check if it's a plan
        const planMatch = filePath.match(PLAN_PATH_PATTERN);
        if (planMatch) {
          const content = readFileSync(filePath, "utf-8");
          const index = await getArtifactIndex();
          const record = parsePlan(content, filePath, planMatch[1]);
          await index.indexPlan(record);
          return;
        }
      } catch (e) {
        // Silent failure - don't interrupt user flow
        log.error("artifact-auto-index", `Error indexing ${filePath}`, e);
      }
    },
  };
}
