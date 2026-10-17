import type { HostEvent, Notification } from "@/host/port";
import { config } from "@/utils/config";

import type { SessionUsageTracker } from "./session-usage";

const PERCENT_MULTIPLIER = 100;
const TOKENS_PER_KILOTOKEN = 1000;

export type Notify = (notification: Notification) => Promise<void>;

export interface ContextWindowMonitorHook {
  /** Text to append to the system prompt, or "" when usage is below the warning threshold. */
  systemSuffix(sessionID: string): string;
  onEvent(event: HostEvent): Promise<void>;
}

function remainingPercent(ratio: number): number {
  return Math.round((1 - ratio) * PERCENT_MULTIPLIER);
}

function encouragement(ratio: number): string {
  const remaining = remainingPercent(ratio);
  if (ratio < config.contextWindow.warningThreshold) return "";
  if (ratio < config.contextWindow.criticalThreshold) {
    return `Context: ${remaining}% remaining. Plenty of room - don't rush.`;
  }
  return `Context: ${remaining}% remaining. Consider wrapping up or compacting soon.`;
}

function kilo(tokens: number): number {
  return Math.round(tokens / TOKENS_PER_KILOTOKEN);
}

export function createContextWindowMonitorHook(usage: SessionUsageTracker, notify: Notify): ContextWindowMonitorHook {
  const lastWarning = new Map<string, number>();

  async function warn(sessionID: string): Promise<void> {
    const current = usage.get(sessionID);
    if (!current || current.ratio < config.contextWindow.warningThreshold) return;
    const previous = lastWarning.get(sessionID) ?? 0;
    if (Date.now() - previous <= config.contextWindow.warningCooldownMs) return;
    lastWarning.set(sessionID, Date.now());

    await notify({
      title: "Context Window",
      message: `${remainingPercent(current.ratio)}% remaining (${kilo(current.used)}K / ${kilo(current.limit)}K tokens)`,
      variant: current.ratio >= config.contextWindow.criticalThreshold ? "warning" : "info",
      duration: config.timeouts.toastWarningMs,
    });
  }

  return {
    systemSuffix(sessionID) {
      const message = encouragement(usage.get(sessionID)?.ratio ?? 0);
      return message ? `\n\n<context-status>${message}</context-status>` : "";
    },
    onEvent: async (event) => {
      if (event.type === "session.deleted") {
        lastWarning.delete(event.sessionID);
        return;
      }
      if (event.type === "assistant.usage") await warn(event.sessionID);
    },
  };
}
