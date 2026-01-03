import type { PluginInput } from "@opencode-ai/plugin";

// Model context limits (tokens)
const MODEL_CONTEXT_LIMITS: Record<string, number> = {
  // Anthropic
  "claude-opus": 200_000,
  "claude-sonnet": 200_000,
  "claude-haiku": 200_000,
  "claude-3": 200_000,
  "claude-4": 200_000,
  // OpenAI
  "gpt-4o": 128_000,
  "gpt-4-turbo": 128_000,
  "gpt-4": 128_000,
  "gpt-5": 200_000,
  o1: 200_000,
  o3: 200_000,
  // Google
  gemini: 1_000_000,
};

const DEFAULT_CONTEXT_LIMIT = 200_000;
const DEFAULT_THRESHOLD = 0.6; // 60% of context window
const MIN_TOKENS_FOR_COMPACTION = 50_000;
const COMPACTION_COOLDOWN_MS = 60_000; // 60 seconds

function getContextLimit(modelID: string): number {
  const modelLower = modelID.toLowerCase();
  for (const [pattern, limit] of Object.entries(MODEL_CONTEXT_LIMITS)) {
    if (modelLower.includes(pattern)) {
      return limit;
    }
  }
  return DEFAULT_CONTEXT_LIMIT;
}

interface CompactionState {
  lastCompactionTime: Map<string, number>;
  compactionInProgress: Set<string>;
}

export function createPreemptiveCompactionHook(ctx: PluginInput) {
  const state: CompactionState = {
    lastCompactionTime: new Map(),
    compactionInProgress: new Set(),
  };

  async function checkAndCompact(sessionID: string, providerID?: string, modelID?: string): Promise<void> {
    // Skip if compaction in progress
    if (state.compactionInProgress.has(sessionID)) return;

    // Respect cooldown
    const lastTime = state.lastCompactionTime.get(sessionID) || 0;
    if (Date.now() - lastTime < COMPACTION_COOLDOWN_MS) return;

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

      if (totalUsed < MIN_TOKENS_FOR_COMPACTION) return;

      // Get model context limit
      const model = modelID || (info?.modelID as string) || "";
      const contextLimit = getContextLimit(model);
      const usageRatio = totalUsed / contextLimit;

      if (usageRatio < DEFAULT_THRESHOLD) return;

      // Skip if last message was already a summary
      const lastUserMsg = [...messages].reverse().find((m) => {
        const msg = m as Record<string, unknown>;
        const msgInfo = msg.info as Record<string, unknown> | undefined;
        return msgInfo?.role === "user";
      }) as Record<string, unknown> | undefined;

      if (lastUserMsg) {
        const parts = lastUserMsg.parts as Array<{ type: string; text?: string }> | undefined;
        const text = parts?.find((p) => p.type === "text")?.text || "";
        if (text.includes("summarized") || text.includes("compacted")) return;
      }

      // Trigger compaction
      state.compactionInProgress.add(sessionID);
      state.lastCompactionTime.set(sessionID, Date.now());

      await ctx.client.tui
        .showToast({
          body: {
            title: "Context Window",
            message: `${Math.round(usageRatio * 100)}% used - auto-compacting...`,
            variant: "warning",
            duration: 3000,
          },
        })
        .catch(() => {});

      const provider = providerID || (info?.providerID as string);
      const modelToUse = modelID || (info?.modelID as string);

      if (provider && modelToUse) {
        await ctx.client.session.summarize({
          path: { id: sessionID },
          body: { providerID: provider, modelID: modelToUse },
          query: { directory: ctx.directory },
        });

        await ctx.client.tui
          .showToast({
            body: {
              title: "Compacted",
              message: "Session summarized successfully",
              variant: "success",
              duration: 3000,
            },
          })
          .catch(() => {});
      }
    } catch (_e) {
      // Silent failure - don't interrupt user flow
    } finally {
      state.compactionInProgress.delete(sessionID);
    }
  }

  return {
    event: async ({ event }: { event: { type: string; properties?: unknown } }) => {
      const props = event.properties as Record<string, unknown> | undefined;

      // Cleanup on session delete
      if (event.type === "session.deleted") {
        const sessionInfo = props?.info as { id?: string } | undefined;
        if (sessionInfo?.id) {
          state.lastCompactionTime.delete(sessionInfo.id);
          state.compactionInProgress.delete(sessionInfo.id);
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
          await checkAndCompact(sessionID, providerID, modelID);
        }
      }

      // Check when session goes idle
      if (event.type === "session.idle") {
        const sessionID = props?.sessionID as string | undefined;
        if (sessionID) {
          await checkAndCompact(sessionID);
        }
      }
    },
  };
}
