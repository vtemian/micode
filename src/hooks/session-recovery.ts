import type { HostEvent, PromptHint, SessionHost } from "@/host/port";
import { extractErrorMessage } from "@/utils/errors";
import { log } from "@/utils/logger";

export interface SessionRecoveryHook {
  onEvent(event: HostEvent): Promise<void>;
}

/** Timing knobs; tests shrink them so recoveries do not wait on real delays. */
export interface RecoveryTiming {
  /** Pause after interrupting before re-prompting, so the host settles. */
  readonly settleMs?: number;
  /** How long an identical error on the same session is treated as a duplicate. */
  readonly dedupExpiryMs?: number;
}

// Error patterns we can recover from
const RECOVERABLE_ERRORS = {
  TOOL_RESULT_MISSING: "tool_result block(s) missing",
  THINKING_BLOCK_ORDER: "thinking blocks must be at the start",
  THINKING_DISABLED: "thinking is not enabled",
  EMPTY_CONTENT: "content cannot be empty",
  INVALID_TOOL_RESULT: "tool_result must follow tool_use",
} as const;

type RecoverableErrorType = keyof typeof RECOVERABLE_ERRORS;

interface RecoveryState {
  readonly processingErrors: Map<string, ReturnType<typeof setTimeout>>;
  readonly recoveryAttempts: Map<string, number>;
  readonly settleMs: number;
  readonly dedupExpiryMs: number;
}

const MAX_RECOVERY_ATTEMPTS = 3;
const ABORT_SETTLE_DELAY_MS = 500;
const RECOVERY_TOAST_DURATION_MS = 3000;
const TOAST_FAILURE_DURATION_MS = 5000;
const ERROR_KEY_EXPIRY_MS = 10000;
const RESUME_PROMPT = "Continue from where you left off.";

function extractErrorInfo(error: unknown): { message: string; messageIndex?: number } | null {
  if (!error) return null;

  let errorStr: string;
  if (typeof error === "string") {
    errorStr = error;
  } else if (error instanceof Error) {
    errorStr = error.message;
  } else {
    errorStr = JSON.stringify(error);
  }

  const errorLower = errorStr.toLowerCase();

  // Extract message index if present (e.g., "messages.5" or "message 5")
  const indexMatch = errorStr.match(/messages?[.\s](\d+)/i);
  const messageIndex = indexMatch ? parseInt(indexMatch[1], 10) : undefined;

  return { message: errorLower, messageIndex };
}

function identifyErrorType(errorMessage: string): RecoverableErrorType | null {
  for (const [type, pattern] of Object.entries(RECOVERABLE_ERRORS)) {
    if (errorMessage.includes(pattern.toLowerCase())) {
      return type as RecoverableErrorType;
    }
  }
  return null;
}

function cleanupSession(state: RecoveryState, sessionID: string): void {
  for (const key of state.recoveryAttempts.keys()) {
    if (key.startsWith(`${sessionID}:`)) state.recoveryAttempts.delete(key);
  }
  for (const [key, timer] of state.processingErrors) {
    if (!key.startsWith(`${sessionID}:`)) continue;
    clearTimeout(timer);
    state.processingErrors.delete(key);
  }
}

function deduplicateError(state: RecoveryState, sessionID: string, errorType: RecoverableErrorType): boolean {
  const errorKey = `${sessionID}:${errorType}`;
  if (state.processingErrors.has(errorKey)) return false;
  const timer = setTimeout(() => state.processingErrors.delete(errorKey), state.dedupExpiryMs);
  state.processingErrors.set(errorKey, timer);
  return true;
}

function classifyError(error: unknown): RecoverableErrorType | null {
  const errorInfo = extractErrorInfo(error);
  if (!errorInfo) return null;
  return identifyErrorType(errorInfo.message);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/** Re-prompts the session; false when there was nothing to resume or the host refused. */
async function resumeSession(host: SessionHost, sessionID: string, hint: PromptHint): Promise<boolean> {
  try {
    const lastUser = await host.lastUserText(sessionID);
    if (!lastUser) return false;
    await host.prompt(sessionID, RESUME_PROMPT, hint);
    return true;
  } catch (error) {
    log.warn("session-recovery", `Resume failed for ${sessionID}: ${extractErrorMessage(error)}`);
    return false;
  }
}

async function notifyOutcome(host: SessionHost, resumed: boolean): Promise<void> {
  if (resumed) {
    await host.notify({
      title: "Recovery Complete",
      message: "Session resumed. Continuing...",
      variant: "success",
      duration: RECOVERY_TOAST_DURATION_MS,
    });
    return;
  }
  await host.notify({
    title: "Recovery Incomplete",
    message: "Session interrupted but not resumed. Send a message to continue.",
    variant: "warning",
    duration: TOAST_FAILURE_DURATION_MS,
  });
}

async function attemptRecovery(
  host: SessionHost,
  state: RecoveryState,
  sessionID: string,
  errorType: RecoverableErrorType,
  hint: PromptHint,
): Promise<void> {
  const recoveryKey = `${sessionID}:${errorType}`;
  const attempts = state.recoveryAttempts.get(recoveryKey) ?? 0;
  if (attempts >= MAX_RECOVERY_ATTEMPTS) {
    await host.notify({
      title: "Recovery Failed",
      message: `Max attempts reached for ${errorType}. Manual intervention needed.`,
      variant: "error",
      duration: TOAST_FAILURE_DURATION_MS,
    });
    return;
  }
  state.recoveryAttempts.set(recoveryKey, attempts + 1);
  await host.notify({
    title: "Session Recovery",
    message: `Recovering from ${errorType.toLowerCase().replace(/_/g, " ")}...`,
    variant: "warning",
    duration: RECOVERY_TOAST_DURATION_MS,
  });

  try {
    await host.interrupt(sessionID);
  } catch {
    // Ignore interrupt errors; the resume attempt is what matters
  }
  await sleep(state.settleMs);
  await notifyOutcome(host, await resumeSession(host, sessionID, hint));
}

export function createSessionRecoveryHook(host: SessionHost, timing?: RecoveryTiming): SessionRecoveryHook {
  const state: RecoveryState = {
    processingErrors: new Map(),
    recoveryAttempts: new Map(),
    settleMs: timing?.settleMs ?? ABORT_SETTLE_DELAY_MS,
    dedupExpiryMs: timing?.dedupExpiryMs ?? ERROR_KEY_EXPIRY_MS,
  };

  return {
    onEvent: async (event) => {
      if (event.type === "session.deleted") {
        cleanupSession(state, event.sessionID);
        return;
      }
      if (event.type !== "session.error") return;
      const errorType = classifyError(event.error);
      if (!errorType) return;
      if (!deduplicateError(state, event.sessionID, errorType)) return;
      await attemptRecovery(host, state, event.sessionID, errorType, { model: event.model, agent: event.agent });
    },
  };
}
