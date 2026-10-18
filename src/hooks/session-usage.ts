import type { HostEvent, ModelRef } from "@/host/port";
import { getSessionModel } from "@/session-model";
import { getContextLimit } from "@/utils/model-limits";

export interface SessionUsage {
  readonly used: number;
  readonly limit: number;
  readonly ratio: number;
  readonly model?: ModelRef;
}

/** Latest context usage per session, fed from normalized `assistant.usage` events. */
export interface SessionUsageTracker {
  onEvent(event: HostEvent): void;
  get(sessionID: string): SessionUsage | undefined;
  /** Drops the stored figure, e.g. after a compaction made it stale. */
  reset(sessionID: string): void;
}

export function createSessionUsage(modelContextLimits?: Map<string, number>): SessionUsageTracker {
  const bySession = new Map<string, SessionUsage>();

  return {
    onEvent(event) {
      if (event.type === "session.deleted") {
        bySession.delete(event.sessionID);
        return;
      }
      if (event.type !== "assistant.usage") return;
      const used = event.input + event.cacheRead + (event.cacheWrite ?? 0);
      if (used === 0) return;
      const model = event.model ?? getSessionModel(event.sessionID);
      const limit = getContextLimit(model?.modelID ?? "", model?.providerID, modelContextLimits);
      bySession.set(event.sessionID, { used, limit, ratio: used / limit, model });
    },
    get: (sessionID) => bySession.get(sessionID),
    reset: (sessionID) => {
      bySession.delete(sessionID);
    },
  };
}
