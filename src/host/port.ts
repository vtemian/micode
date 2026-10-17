/** The project the plugin instance was loaded for. Hooks that only read files need nothing else. */
export interface Workspace {
  readonly directory: string;
}

export interface ModelRef {
  readonly providerID: string;
  readonly modelID: string;
}

export interface Notification {
  readonly title: string;
  readonly message: string;
  readonly variant: "info" | "success" | "warning" | "error";
  readonly duration: number;
}

export interface AgentRun {
  readonly agent: string;
  readonly text: string;
  readonly title?: string;
  /** Links the new session under its spawner in the session tree (#59). */
  readonly parentID?: string;
  readonly model?: ModelRef;
  /** The run may not call tools (reviewer, probe). v1 sends `tools: {}`; v2 sends a deny-all ruleset. */
  readonly denyTools?: boolean;
  /** Fires as soon as the session exists, before the prompt runs. */
  readonly onCreated?: (sessionID: string) => void;
}

export interface AgentReply {
  readonly sessionID: string;
  /** Text of the last completed, error-free assistant turn. */
  readonly text: string;
}

export interface PromptHint {
  readonly model?: ModelRef;
  readonly agent?: string;
}

/**
 * Everything micode needs from a host session API. Each adapter implements it once.
 * `remove` and `notify` are best-effort and never throw; every other method rejects on failure.
 */
export interface SessionHost {
  /** Create a session, run one prompt to completion and return the reply. The session is kept. */
  runAgent(run: AgentRun): Promise<AgentReply>;
  /** Best-effort delete; never throws. */
  remove(sessionID: string): Promise<void>;
  /** Enqueue a user prompt on an existing session and return without waiting. */
  prompt(sessionID: string, text: string, hint?: PromptHint): Promise<void>;
  interrupt(sessionID: string): Promise<void>;
  /** Run compaction to completion and resolve with the summary text. */
  compact(sessionID: string, model: ModelRef): Promise<string>;
  lastUserText(sessionID: string): Promise<string | undefined>;
  /** Best-effort, never throws. v1 shows a TUI toast; v2 has no server-side toast and logs instead. */
  notify(notification: Notification): Promise<void>;
}

export type HostEvent =
  | { readonly type: "session.deleted"; readonly sessionID: string }
  | {
      readonly type: "assistant.usage";
      readonly sessionID: string;
      readonly input: number;
      readonly cacheRead: number;
      readonly model?: ModelRef;
    }
  | {
      readonly type: "session.error";
      readonly sessionID: string;
      readonly error: unknown;
      readonly model?: ModelRef;
      readonly agent?: string;
    };

export const DENY_ALL_TOOLS = [{ action: "*", resource: "*", effect: "deny" }] as const;
