// src/hooks/constraint-reviewer.ts
import type { PluginInput } from "@opencode-ai/plugin";

import {
  formatViolationsForRetry,
  formatViolationsForUser,
  type LoadedMindmodel,
  loadMindmodel,
  parseReviewResponse,
  type ReviewResult,
} from "../mindmodel";
import { config } from "../utils/config";
import { log } from "../utils/logger";

type ReviewFn = (prompt: string) => Promise<string>;

interface ReviewState {
  retryCount: number;
  lastViolations: string;
  overrideActive: boolean;
}

export function createConstraintReviewerHook(ctx: PluginInput, reviewFn: ReviewFn) {
  let cachedMindmodel: LoadedMindmodel | null | undefined;
  const sessionState = new Map<string, ReviewState>();

  async function getMindmodel(): Promise<LoadedMindmodel | null> {
    if (cachedMindmodel === undefined) {
      cachedMindmodel = await loadMindmodel(ctx.directory);
    }
    return cachedMindmodel;
  }

  function getSessionState(sessionID: string): ReviewState {
    if (!sessionState.has(sessionID)) {
      sessionState.set(sessionID, {
        retryCount: 0,
        lastViolations: "",
        overrideActive: false,
      });
    }
    return sessionState.get(sessionID)!;
  }

  return {
    "tool.execute.after": async (
      input: { tool: string; sessionID: string; args?: Record<string, unknown> },
      output: { output?: string },
    ) => {
      // Only review Write and Edit operations
      if (!["Write", "Edit"].includes(input.tool)) return;
      if (!config.mindmodel.reviewEnabled) return;

      const mindmodel = await getMindmodel();
      if (!mindmodel) return;

      const state = getSessionState(input.sessionID);

      // Skip if override is active
      if (state.overrideActive) {
        state.overrideActive = false;
        return;
      }

      const filePath = input.args?.file_path as string | undefined;
      if (!filePath) return;

      try {
        // Build review prompt
        const reviewPrompt = buildReviewPrompt(output.output || "", filePath, mindmodel);

        // Call reviewer
        const reviewResponse = await reviewFn(reviewPrompt);
        const result = parseReviewResponse(reviewResponse);

        if (result.status === "PASS") {
          state.retryCount = 0;
          return;
        }

        // Handle violations
        if (state.retryCount < config.mindmodel.reviewMaxRetries) {
          // Trigger retry by modifying output
          state.retryCount++;
          state.lastViolations = formatViolationsForRetry(result.violations);
          output.output = `${output.output}\n\n<constraint-violations>\n${state.lastViolations}\n</constraint-violations>`;
        } else {
          // Max retries reached - block
          state.retryCount = 0;
          const userMessage = formatViolationsForUser(result.violations);
          throw new ConstraintViolationError(userMessage, result);
        }
      } catch (error) {
        if (error instanceof ConstraintViolationError) {
          throw error;
        }
        // Log but don't block on review failures
        log.warn("mindmodel", `Review failed: ${error instanceof Error ? error.message : "unknown"}`);
      }
    },

    "chat.message": async (input: { sessionID: string }, output: { parts: Array<{ type: string; text?: string }> }) => {
      // Check for override command
      const text = output.parts
        .filter((p) => p.type === "text" && p.text)
        .map((p) => p.text)
        .join(" ");

      const overrideMatch = text.match(/^override:\s*(.+)$/im);
      if (overrideMatch) {
        const state = getSessionState(input.sessionID);
        state.overrideActive = true;

        // Log the override
        const reason = overrideMatch[1].trim();
        await logOverride(ctx.directory, reason);

        log.info("mindmodel", `Override activated: ${reason}`);
      }
    },
  };
}

function buildReviewPrompt(code: string, filePath: string, mindmodel: LoadedMindmodel): string {
  // For now, include all constraints - selective loading can be added later
  const constraintSummary = mindmodel.manifest.categories.map((c) => `- ${c.path}: ${c.description}`).join("\n");

  return `Review this generated code against project constraints.

File: ${filePath}

Code:
\`\`\`
${code}
\`\`\`

Available constraints:
${constraintSummary}

Return JSON with status "PASS" or "BLOCKED" and any violations found.`;
}

async function logOverride(projectDir: string, reason: string): Promise<void> {
  const { appendFile, mkdir } = await import("node:fs/promises");
  const { join } = await import("node:path");

  const logPath = join(projectDir, ".mindmodel", config.mindmodel.overrideLogFile);
  const timestamp = new Date().toISOString();
  const entry = `${timestamp} | override | reason: "${reason}"\n`;

  try {
    await mkdir(join(projectDir, ".mindmodel"), { recursive: true });
    await appendFile(logPath, entry);
  } catch {
    // Ignore logging failures
  }
}

export class ConstraintViolationError extends Error {
  constructor(
    message: string,
    public readonly result: ReviewResult,
  ) {
    super(message);
    this.name = "ConstraintViolationError";
  }
}
