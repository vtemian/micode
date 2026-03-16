import type { PluginInput } from "@opencode-ai/plugin";

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

interface RecoveryContext {
  ctx: PluginInput;
  state: RecoveryState;
}

async function getSessionMessages(rc: RecoveryContext, sessionID: string): Promise<unknown[]> {
  try {
    const resp = await rc.ctx.client.session.messages({
      path: { id: sessionID },
      query: { directory: rc.ctx.directory },
    });
    return (resp as { data?: unknown[] }).data || [];
  } catch {
    return [];
  }
}

async function abortSession(rc: RecoveryContext, sessionID: string): Promise<void> {
  try {
    await rc.ctx.client.session.abort({
      path: { id: sessionID },
      query: { directory: rc.ctx.directory },
    });
  } catch {
    // Ignore abort errors
  }
}

async function resumeSession(
  rc: RecoveryContext,
  sessionID: string,
  providerID?: string,
  modelID?: string,
  agent?: string,
): Promise<void> {
  try {
    const messages = await getSessionMessages(rc, sessionID);
    const lastUserMsg = [...messages].reverse().find((m) => {
      const msg = m as Record<string, unknown>;
      const info = msg.info as Record<string, unknown> | undefined;
      return info?.role === "user";
    });

    if (!lastUserMsg) return;

    const parts = (lastUserMsg as Record<string, unknown>).parts as Array<{ type: string; text?: string }>;
    const text = parts?.find((p) => p.type === "text")?.text;
    if (!text) return;

    await rc.ctx.client.session.prompt({
      path: { id: sessionID },
      body: {
        parts: [{ type: "text", text: "Continue from where you left off." }],
        ...(providerID && modelID ? { providerID, modelID } : {}),
        ...(agent ? { agent } : {}),
      },
      query: { directory: rc.ctx.directory },
    });
  } catch {
    // Resume failed - user will need to manually continue
  }
}

function showToast(
  rc: RecoveryContext,
  title: string,
  message: string,
  variant: "info" | "success" | "warning" | "error",
  duration: number,
): void {
  rc.ctx.client.tui.showToast({ body: { title, message, variant, duration } }).catch((_e: unknown) => {
    /* fire-and-forget */
  });
}

async function attemptRecovery(
  rc: RecoveryContext,
  sessionID: string,
  errorType: RecoverableErrorType,
  providerID?: string,
  modelID?: string,
  agent?: string,
): Promise<boolean> {
  const recoveryKey = `${sessionID}:${errorType}`;
  const attempts = rc.state.recoveryAttempts.get(recoveryKey) || 0;

  if (attempts >= MAX_RECOVERY_ATTEMPTS) {
    showToast(
      rc,
      "Recovery Failed",
      `Max attempts reached for ${errorType}. Manual intervention needed.`,
      "error",
      TOAST_FAILURE_DURATION_MS,
    );
    return false;
  }

  rc.state.recoveryAttempts.set(recoveryKey, attempts + 1);
  showToast(
    rc,
    "Session Recovery",
    `Recovering from ${errorType.toLowerCase().replace(/_/g, " ")}...`,
    "warning",
    RECOVERY_TOAST_DURATION_MS,
  );

  await abortSession(rc, sessionID);
  await new Promise((resolve) => setTimeout(resolve, ABORT_SETTLE_DELAY_MS));
  await resumeSession(rc, sessionID, providerID, modelID, agent);

  showToast(rc, "Recovery Complete", "Session resumed. Continuing...", "success", RECOVERY_TOAST_DURATION_MS);
  return true;
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

async function handleSessionError(rc: RecoveryContext, props: Record<string, unknown> | undefined): Promise<void> {
  const sessionID = props?.sessionID as string | undefined;
  const error = props?.error;
  if (!sessionID || !error) return;

  const errorType = classifyError(error);
  if (!errorType) return;
  if (!deduplicateError(rc.state, sessionID, errorType)) return;

  await attemptRecovery(rc, sessionID, errorType);
}

async function handleMessageError(rc: RecoveryContext, props: Record<string, unknown> | undefined): Promise<void> {
  const info = props?.info as Record<string, unknown> | undefined;
  const sessionID = info?.sessionID as string | undefined;
  const error = info?.error;
  if (!sessionID || !error) return;

  const errorType = classifyError(error);
  if (!errorType) return;
  if (!deduplicateError(rc.state, sessionID, errorType)) return;

  const providerID = info.providerID as string | undefined;
  const modelID = info.modelID as string | undefined;
  const agent = info.agent as string | undefined;
  await attemptRecovery(rc, sessionID, errorType, providerID, modelID, agent);
}

interface SessionRecoveryHooks {
  event: (input: { event: { type: string; properties?: unknown } }) => Promise<void>;
}

export function createSessionRecoveryHook(ctx: PluginInput): SessionRecoveryHooks {
  const rc: RecoveryContext = {
    ctx,
    state: { processingErrors: new Set(), recoveryAttempts: new Map() },
  };

  return {
    event: async ({ event }: { event: { type: string; properties?: unknown } }) => {
      const props = event.properties as Record<string, unknown> | undefined;

      if (event.type === "session.deleted") {
        const sessionInfo = props?.info as { id?: string } | undefined;
        if (sessionInfo?.id) cleanupSession(rc.state, sessionInfo.id);
        return;
      }

      if (event.type === "session.error") await handleSessionError(rc, props);
      if (event.type === "message.updated") await handleMessageError(rc, props);
    },
  };
}
