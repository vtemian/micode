// src/hooks/constraint-reviewer.ts
import type { PluginInput } from "@opencode-ai/plugin";

import {
  formatViolationsForRetry,
  formatViolationsForUser,
  type LoadedMindmodel,
  loadMindmodel,
  parseReviewResponse,
  type ReviewResult,
} from "@/mindmodel";
import { config } from "@/utils/config";
import { extractErrorMessage } from "@/utils/errors";
import { log } from "@/utils/logger";

type Reviewer = (prompt: string) => Promise<string>;

interface ReviewState {
  /** Retry count per file path */
  retryCountByFile: Map<string, number>;
  /** Override active for remainder of turn */
  overrideActive: boolean;
}

interface ConstraintReviewerHooks {
  "tool.execute.after": (
    input: { tool: string; sessionID: string; args?: Record<string, unknown> },
    output: { output?: string },
  ) => Promise<void>;
  "chat.message": (
    input: { sessionID: string },
    output: { parts: Array<{ type: string; text?: string }> },
  ) => Promise<void>;
  cleanupSession: (sessionID: string) => void;
}

export function createConstraintReviewerHook(ctx: PluginInput, review: Reviewer): ConstraintReviewerHooks {
  let mindmodel: LoadedMindmodel | null | undefined;
  const sessionState = new Map<string, ReviewState>();

  async function getMindmodel(): Promise<LoadedMindmodel | null> {
    if (mindmodel === undefined) {
      mindmodel = await loadMindmodel(ctx.directory);
    }
    return mindmodel;
  }

  function getSessionState(sessionID: string): ReviewState {
    if (!sessionState.has(sessionID)) {
      sessionState.set(sessionID, {
        retryCountByFile: new Map(),
        overrideActive: false,
      });
    }
    // Safe to assert: we just set it above if it didn't exist
    return sessionState.get(sessionID) as ReviewState;
  }

  function cleanupSession(sessionID: string): void {
    sessionState.delete(sessionID);
  }

  return {
    "tool.execute.after": async (
      input: { tool: string; sessionID: string; args?: Record<string, unknown> },
      output: { output?: string },
    ) => {
      const mindmodel = await getMindmodel();
      await reviewToolOutput(input, output, mindmodel, getSessionState, review);
    },

    "chat.message": async (input: { sessionID: string }, output: { parts: Array<{ type: string; text?: string }> }) => {
      await handleChatMessage(ctx, input, output, getSessionState);
    },

    /** Cleanup session state on session deletion to prevent memory leaks */
    cleanupSession,
  };
}

function handleReviewError(error: unknown): void {
  if (error instanceof ConstraintViolationError) {
    throw error;
  }
  log.warn("mindmodel", `Review failed: ${extractErrorMessage(error)}`);
}

async function reviewToolOutput(
  input: { tool: string; sessionID: string; args?: Record<string, unknown> },
  output: { output?: string },
  mindmodel: LoadedMindmodel | null,
  getSessionState: (sessionID: string) => ReviewState,
  review: Reviewer,
): Promise<void> {
  if (!["Write", "Edit"].includes(input.tool)) return;
  if (!config.mindmodel.reviewEnabled) return;
  if (!mindmodel) return;

  const state = getSessionState(input.sessionID);

  if (state.overrideActive) {
    state.overrideActive = false;
    return;
  }

  const filePath = input.args?.file_path as string | undefined;
  if (!filePath) return;

  try {
    const reviewPrompt = buildReviewPrompt(output.output || "", filePath, mindmodel);
    const reviewResponse = await review(reviewPrompt);
    const result = parseReviewResponse(reviewResponse);

    if (result.status === "PASS") {
      state.retryCountByFile.delete(filePath);
      return;
    }

    handleViolations(state, filePath, result, output);
  } catch (error) {
    handleReviewError(error);
  }
}

function handleViolations(
  state: ReviewState,
  filePath: string,
  result: ReviewResult,
  output: { output?: string },
): void {
  const retryCount = state.retryCountByFile.get(filePath) || 0;

  if (retryCount < config.mindmodel.reviewMaxRetries) {
    state.retryCountByFile.set(filePath, retryCount + 1);
    const violationsText = formatViolationsForRetry(result.violations);
    output.output = `${output.output}\n\n<constraint-violations>\n${violationsText}\n</constraint-violations>`;
    return;
  }

  state.retryCountByFile.delete(filePath);
  const userMessage = formatViolationsForUser(result.violations);
  throw new ConstraintViolationError(userMessage, result);
}

async function handleChatMessage(
  ctx: PluginInput,
  input: { sessionID: string },
  output: { parts: Array<{ type: string; text?: string }> },
  getSessionState: (sessionID: string) => ReviewState,
): Promise<void> {
  const text = output.parts
    .filter((p) => p.type === "text" && p.text)
    .map((p) => p.text)
    .join(" ");

  const overrideMatch = text.match(/^override:\s*(.+)$/im);
  if (!overrideMatch) return;

  const state = getSessionState(input.sessionID);
  state.overrideActive = true;

  const reason = overrideMatch[1].trim();
  await logOverride(ctx.directory, reason);

  log.info("mindmodel", `Override activated: ${reason}`);
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
