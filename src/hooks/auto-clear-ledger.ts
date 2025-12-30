// src/hooks/auto-clear-ledger.ts
import type { PluginInput } from "@opencode-ai/plugin";
import { findCurrentLedger, formatLedgerInjection } from "./ledger-loader";
import { getFileOps, clearFileOps, formatFileOpsForPrompt } from "./file-ops-tracker";

// Model context limits (tokens)
const MODEL_CONTEXT_LIMITS: Record<string, number> = {
  "claude-opus": 200_000,
  "claude-sonnet": 200_000,
  "claude-haiku": 200_000,
  "claude-3": 200_000,
  "claude-4": 200_000,
  "gpt-4o": 128_000,
  "gpt-4-turbo": 128_000,
  "gpt-4": 128_000,
  "gpt-5": 200_000,
  o1: 200_000,
  o3: 200_000,
  gemini: 1_000_000,
};

const DEFAULT_CONTEXT_LIMIT = 200_000;
export const DEFAULT_THRESHOLD = 0.8;
const MIN_TOKENS_FOR_CLEAR = 50_000;
export const CLEAR_COOLDOWN_MS = 60_000;

function getContextLimit(modelID: string): number {
  const modelLower = modelID.toLowerCase();
  for (const [pattern, limit] of Object.entries(MODEL_CONTEXT_LIMITS)) {
    if (modelLower.includes(pattern)) {
      return limit;
    }
  }
  return DEFAULT_CONTEXT_LIMIT;
}

interface ClearState {
  lastClearTime: Map<string, number>;
  clearInProgress: Set<string>;
}

export function createAutoClearLedgerHook(ctx: PluginInput) {
  const state: ClearState = {
    lastClearTime: new Map(),
    clearInProgress: new Set(),
  };

  async function checkAndClear(sessionID: string, _providerID?: string, modelID?: string): Promise<void> {
    // Skip if clear in progress
    if (state.clearInProgress.has(sessionID)) return;

    // Respect cooldown
    const lastTime = state.lastClearTime.get(sessionID) || 0;
    if (Date.now() - lastTime < CLEAR_COOLDOWN_MS) return;

    try {
      // Get session messages to calculate token usage
      const resp = await ctx.client.session.messages({
        path: { id: sessionID },
        query: { directory: ctx.directory },
      });

      const messages = (resp as { data?: unknown[] }).data;
      if (!Array.isArray(messages) || messages.length === 0) return;

      // Find last assistant message with token info
      const lastAssistant = [...messages].reverse().find((m) => {
        const msg = m as Record<string, unknown>;
        const info = msg.info as Record<string, unknown> | undefined;
        return info?.role === "assistant";
      }) as Record<string, unknown> | undefined;

      if (!lastAssistant) return;

      const info = lastAssistant.info as Record<string, unknown> | undefined;
      const usage = info?.usage as Record<string, unknown> | undefined;

      // Calculate token usage
      const inputTokens = (usage?.inputTokens as number) || 0;
      const cacheRead = (usage?.cacheReadInputTokens as number) || 0;
      const totalUsed = inputTokens + cacheRead;

      if (totalUsed < MIN_TOKENS_FOR_CLEAR) return;

      // Get model context limit
      const model = modelID || (info?.modelID as string) || "";
      const contextLimit = getContextLimit(model);
      const usageRatio = totalUsed / contextLimit;

      if (usageRatio < DEFAULT_THRESHOLD) return;

      // Start clear process
      state.clearInProgress.add(sessionID);
      state.lastClearTime.set(sessionID, Date.now());

      await ctx.client.tui
        .showToast({
          body: {
            title: "Context Window",
            message: `${Math.round(usageRatio * 100)}% used - saving ledger and clearing...`,
            variant: "warning",
            duration: 3000,
          },
        })
        .catch(() => {});

      // Step 1: Get file operations and existing ledger (don't clear yet)
      const fileOps = getFileOps(sessionID);
      const existingLedger = await findCurrentLedger(ctx.directory);

      // Step 2: Spawn ledger-creator agent to update ledger
      const ledgerSessionResp = await ctx.client.session.create({
        body: {},
        query: { directory: ctx.directory },
      });
      const ledgerSessionID = (ledgerSessionResp as { data?: { id?: string } }).data?.id;

      if (ledgerSessionID) {
        // Build prompt with previous ledger and file ops
        let promptText = "";

        if (existingLedger) {
          promptText += `<previous-ledger>\n${existingLedger.content}\n</previous-ledger>\n\n`;
        }

        promptText += formatFileOpsForPrompt(fileOps);
        promptText += "\n\n<instruction>\n";
        promptText += existingLedger
          ? "Update the ledger with the current session state. Merge the file operations above with any existing ones in the previous ledger."
          : "Create a new continuity ledger for this session.";
        promptText += "\n</instruction>";

        await ctx.client.session.prompt({
          path: { id: ledgerSessionID },
          body: {
            parts: [{ type: "text", text: promptText }],
            agent: "ledger-creator",
          },
          query: { directory: ctx.directory },
        });

        // Wait for ledger completion (poll for idle)
        let attempts = 0;
        let ledgerCompleted = false;
        while (attempts < 30) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
          const statusResp = await ctx.client.session.get({
            path: { id: ledgerSessionID },
            query: { directory: ctx.directory },
          });
          if ((statusResp as { data?: { status?: string } }).data?.status === "idle") {
            ledgerCompleted = true;
            break;
          }
          attempts++;
        }

        // Only clear file ops after ledger-creator successfully completed
        if (ledgerCompleted) {
          clearFileOps(sessionID);
        }
      }

      // Step 3: Get first message ID for revert
      const firstMessage = messages[0] as Record<string, unknown> | undefined;
      const firstMessageID = (firstMessage?.info as Record<string, unknown> | undefined)?.id as string | undefined;

      if (!firstMessageID) {
        throw new Error("Could not find first message ID for revert");
      }

      // Step 4: Revert session to first message
      await ctx.client.session.revert({
        path: { id: sessionID },
        body: { messageID: firstMessageID },
        query: { directory: ctx.directory },
      });

      // Step 5: Inject ledger context
      const ledger = await findCurrentLedger(ctx.directory);
      if (ledger) {
        const injection = formatLedgerInjection(ledger);
        await ctx.client.session.prompt({
          path: { id: sessionID },
          body: {
            parts: [{ type: "text", text: injection }],
            noReply: true,
          },
          query: { directory: ctx.directory },
        });
      }

      await ctx.client.tui
        .showToast({
          body: {
            title: "Context Cleared",
            message: "Ledger saved. Session ready to continue.",
            variant: "success",
            duration: 5000,
          },
        })
        .catch(() => {});
    } catch (e) {
      // Log error but don't interrupt user flow
      console.error("[auto-clear-ledger] Error:", e);
      await ctx.client.tui
        .showToast({
          body: {
            title: "Clear Failed",
            message: "Could not complete context clear. Continuing normally.",
            variant: "error",
            duration: 5000,
          },
        })
        .catch(() => {});
    } finally {
      state.clearInProgress.delete(sessionID);
    }
  }

  return {
    event: async ({ event }: { event: { type: string; properties?: unknown } }) => {
      const props = event.properties as Record<string, unknown> | undefined;

      // Cleanup on session delete
      if (event.type === "session.deleted") {
        const sessionInfo = props?.info as { id?: string } | undefined;
        if (sessionInfo?.id) {
          state.lastClearTime.delete(sessionInfo.id);
          state.clearInProgress.delete(sessionInfo.id);
        }
        return;
      }

      // Check on message update (assistant finished)
      if (event.type === "message.updated") {
        const info = props?.info as Record<string, unknown> | undefined;
        const sessionID = info?.sessionID as string | undefined;

        if (sessionID && info?.role === "assistant") {
          const providerID = info.providerID as string | undefined;
          const modelID = info.modelID as string | undefined;
          await checkAndClear(sessionID, providerID, modelID);
        }
      }

      // Check when session goes idle
      if (event.type === "session.idle") {
        const sessionID = props?.sessionID as string | undefined;
        if (sessionID) {
          await checkAndClear(sessionID);
        }
      }
    },
  };
}
