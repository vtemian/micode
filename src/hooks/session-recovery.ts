import type { HostEvent, PromptHint, SessionHost } from "@/host/port";

export interface SessionRecoveryHook {
  onEvent(event: HostEvent): Promise<void>;
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
  processingErrors: Set<string>;
  recoveryAttempts: Map<string, number>;
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
  for (const key of state.processingErrors) {
    if (key.startsWith(`${sessionID}:`)) state.processingErrors.delete(key);
  }
}

function deduplicateError(state: RecoveryState, sessionID: string, errorType: RecoverableErrorType): boolean {
  const errorKey = `${sessionID}:${errorType}`;
  if (state.processingErrors.has(errorKey)) return false;
  state.processingErrors.add(errorKey);
  setTimeout(() => state.processingErrors.delete(errorKey), ERROR_KEY_EXPIRY_MS);
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

async function resumeSession(host: SessionHost, sessionID: string, hint: PromptHint): Promise<void> {
  try {
    const lastUser = await host.lastUserText(sessionID);
    if (!lastUser) return;
    await host.prompt(sessionID, RESUME_PROMPT, hint);
  } catch {
    // Resume failed - the user will need to continue manually
  }
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
  await sleep(ABORT_SETTLE_DELAY_MS);
  await resumeSession(host, sessionID, hint);
  await host.notify({
    title: "Recovery Complete",
    message: "Session resumed. Continuing...",
    variant: "success",
    duration: RECOVERY_TOAST_DURATION_MS,
  });
}

export function createSessionRecoveryHook(host: SessionHost): SessionRecoveryHook {
  const state: RecoveryState = { processingErrors: new Set(), recoveryAttempts: new Map() };

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
