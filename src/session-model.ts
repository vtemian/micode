// src/session-model.ts
/**
 * Tracks the model each session is currently using so spawned subagent
 * sessions can follow the parent's model instead of falling back to the model
 * baked into the agent config at plugin startup.
 *
 * opencode's built-in task tool passes the parent model through when spawning
 * subagents, but the `spawn_agent` tool creates sessions via `session.prompt`
 * without a model. When a user switches models with `/models`, the switch only
 * affects the running session; the plugin's agent configs are baked once at
 * startup. This module captures the live model from each `chat.message` and
 * replays it onto child sessions.
 */
export interface SessionModel {
  providerID: string;
  modelID: string;
}

export const sessionModels = new Map<string, SessionModel>();

export function getSessionModel(sessionID: string): SessionModel | undefined {
  return sessionModels.get(sessionID);
}

export function setSessionModel(sessionID: string, model: SessionModel): void {
  sessionModels.set(sessionID, model);
}

export function deleteSessionModel(sessionID: string): void {
  sessionModels.delete(sessionID);
}

/**
 * The model a spawned agent should run with: the parent session's live model,
 * unless the agent has an explicit model override in micode.json — a
 * deliberate per-agent choice always wins over "follow the parent".
 */
export function resolveSpawnModel(
  sessionID: string,
  agent: string,
  agentModelOverrides?: ReadonlySet<string>,
): SessionModel | undefined {
  if (agentModelOverrides?.has(agent)) return undefined;
  return getSessionModel(sessionID);
}
