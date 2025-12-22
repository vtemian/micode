import type { PluginInput } from "@opencode-ai/plugin";

// Thresholds for context window warnings
const WARNING_THRESHOLD = 0.70; // 70% - remind there's still room
const CRITICAL_THRESHOLD = 0.85; // 85% - getting tight

const DEFAULT_CONTEXT_LIMIT = 200_000;

// Model context limits
const MODEL_CONTEXT_LIMITS: Record<string, number> = {
  "claude-opus": 200_000,
  "claude-sonnet": 200_000,
  "claude-haiku": 200_000,
  "gpt-4": 128_000,
  "gpt-5": 200_000,
  "o1": 200_000,
  "o3": 200_000,
  "gemini": 1_000_000,
};

function getContextLimit(modelID: string): number {
  const modelLower = modelID.toLowerCase();
  for (const [pattern, limit] of Object.entries(MODEL_CONTEXT_LIMITS)) {
    if (modelLower.includes(pattern)) {
      return limit;
    }
  }
  return DEFAULT_CONTEXT_LIMIT;
}

interface MonitorState {
  lastWarningTime: Map<string, number>;
  lastUsageRatio: Map<string, number>;
}

const WARNING_COOLDOWN_MS = 120_000; // 2 minutes between warnings

export function createContextWindowMonitorHook(ctx: PluginInput) {
  const state: MonitorState = {
    lastWarningTime: new Map(),
    lastUsageRatio: new Map(),
  };

  function getEncouragementMessage(usageRatio: number): string {
    const remaining = Math.round((1 - usageRatio) * 100);

    if (usageRatio < WARNING_THRESHOLD) {
      return ""; // No message needed
    }

    if (usageRatio < CRITICAL_THRESHOLD) {
      return `Context: ${remaining}% remaining. Plenty of room - don't rush.`;
    }

    return `Context: ${remaining}% remaining. Consider wrapping up or compacting soon.`;
  }

  return {
    // Inject context awareness into chat params
    "chat.params": async (
      input: { sessionID: string },
      output: { system?: string; options?: Record<string, unknown> }
    ) => {
      const usageRatio = state.lastUsageRatio.get(input.sessionID);

      if (usageRatio && usageRatio >= WARNING_THRESHOLD) {
        const message = getEncouragementMessage(usageRatio);
        if (message && output.system) {
          output.system = `${output.system}\n\n<context-status>${message}</context-status>`;
        }
      }
    },

    event: async ({ event }: { event: { type: string; properties?: unknown } }) => {
      const props = event.properties as Record<string, unknown> | undefined;

      // Cleanup on session delete
      if (event.type === "session.deleted") {
        const sessionInfo = props?.info as { id?: string } | undefined;
        if (sessionInfo?.id) {
          state.lastWarningTime.delete(sessionInfo.id);
          state.lastUsageRatio.delete(sessionInfo.id);
        }
        return;
      }

      // Track usage on message updates
      if (event.type === "message.updated") {
        const info = props?.info as Record<string, unknown> | undefined;
        const sessionID = info?.sessionID as string | undefined;

        if (!sessionID || info?.role !== "assistant") return;

        const usage = info.usage as Record<string, unknown> | undefined;
        const inputTokens = (usage?.inputTokens as number) || 0;
        const cacheRead = (usage?.cacheReadInputTokens as number) || 0;
        const totalUsed = inputTokens + cacheRead;

        const modelID = (info.modelID as string) || "";
        const contextLimit = getContextLimit(modelID);
        const usageRatio = totalUsed / contextLimit;

        state.lastUsageRatio.set(sessionID, usageRatio);

        // Show toast warning if threshold crossed
        if (usageRatio >= WARNING_THRESHOLD) {
          const lastWarning = state.lastWarningTime.get(sessionID) || 0;
          if (Date.now() - lastWarning > WARNING_COOLDOWN_MS) {
            state.lastWarningTime.set(sessionID, Date.now());

            const remaining = Math.round((1 - usageRatio) * 100);
            const variant = usageRatio >= CRITICAL_THRESHOLD ? "warning" : "info";

            await ctx.client.tui
              .showToast({
                body: {
                  title: "Context Window",
                  message: `${remaining}% remaining (${Math.round(totalUsed / 1000)}K / ${Math.round(contextLimit / 1000)}K tokens)`,
                  variant,
                  duration: 4000,
                },
              })
              .catch(() => {});
          }
        }
      }
    },
  };
}
