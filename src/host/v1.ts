import type { PluginInput } from "@opencode-ai/plugin";
import { type ToolDefinition, tool } from "@opencode-ai/plugin/tool";

import type { MicodeTool } from "@/tools/define";
import { config } from "@/utils/config";

import type { AgentReply, AgentRun, HostEvent, ModelRef, Notification, PromptHint, SessionHost } from "./port";

type Client = PluginInput["client"];

interface Part {
  readonly type: string;
  readonly text?: string;
}

interface MessageInfo {
  readonly role?: string;
  readonly summary?: boolean;
  readonly sessionID?: string;
  readonly tokens?: { readonly input?: number; readonly cache?: { readonly read?: number } };
  readonly providerID?: string;
  readonly modelID?: string;
  readonly error?: unknown;
  readonly agent?: string;
}

interface V1Message {
  readonly info?: MessageInfo;
  readonly parts?: readonly Part[];
}

/** The untyped `{ type, properties }` v1 event envelope. */
export interface V1Event {
  readonly type: string;
  readonly properties?: unknown;
}

export interface V1Host extends SessionHost {
  /** Normalizes a v1 event and settles any pending compaction it completes. */
  relay(event: V1Event): HostEvent | undefined;
}

interface Pending {
  readonly resolve: () => void;
  readonly reject: (error: Error) => void;
  readonly timeoutId: ReturnType<typeof setTimeout>;
}

/** v1 tool contexts carry an undocumented `metadata({ title })` used for progress. */
interface ProgressContext {
  readonly sessionID?: string;
  readonly metadata?: (input: { title?: string }) => void;
}

const USER_ROLE = "user";
const ASSISTANT_ROLE = "assistant";
const MESSAGE_UPDATED = "message.updated";
const SESSION_ERROR = "session.error";
const SESSION_DELETED = "session.deleted";

export function joinTextParts(parts: readonly Part[] | undefined): string {
  return (parts ?? [])
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");
}

function lastMessage(messages: readonly V1Message[], role: string, summary?: boolean): V1Message | undefined {
  return [...messages]
    .reverse()
    .find((m) => m.info?.role === role && (summary === undefined || m.info?.summary === summary));
}

function modelOf(info: MessageInfo | undefined): ModelRef | undefined {
  return info?.providerID && info.modelID ? { providerID: info.providerID, modelID: info.modelID } : undefined;
}

function normalizeMessageUpdated(info: MessageInfo | undefined): HostEvent | undefined {
  if (!info?.sessionID || info.role !== ASSISTANT_ROLE) return undefined;
  if (info.error) {
    return {
      type: SESSION_ERROR,
      sessionID: info.sessionID,
      error: info.error,
      model: modelOf(info),
      agent: info.agent,
    };
  }
  const input = info.tokens?.input ?? 0;
  const cacheRead = info.tokens?.cache?.read ?? 0;
  if (input + cacheRead === 0) return undefined;
  return { type: "assistant.usage", sessionID: info.sessionID, input, cacheRead, model: modelOf(info) };
}

function propertiesOf(event: V1Event): Record<string, unknown> {
  return typeof event.properties === "object" && event.properties !== null
    ? (event.properties as Record<string, unknown>)
    : {};
}

function normalize(event: V1Event): HostEvent | undefined {
  const props = propertiesOf(event);
  if (event.type === SESSION_DELETED) {
    const id = (props.info as { id?: string } | undefined)?.id;
    return id ? { type: SESSION_DELETED, sessionID: id } : undefined;
  }
  if (event.type === SESSION_ERROR) {
    const sessionID = typeof props.sessionID === "string" ? props.sessionID : undefined;
    return sessionID && props.error ? { type: SESSION_ERROR, sessionID, error: props.error } : undefined;
  }
  if (event.type === MESSAGE_UPDATED) return normalizeMessageUpdated(props.info as MessageInfo | undefined);
  return undefined;
}

/** The session id of a `message.updated` event that marks a finished compaction, if it is one. */
function summarizedSession(event: V1Event): string | undefined {
  if (event.type !== MESSAGE_UPDATED) return undefined;
  const info = propertiesOf(event).info as MessageInfo | undefined;
  return info?.role === ASSISTANT_ROLE && info.summary === true ? info.sessionID : undefined;
}

export function toV1Tool(core: MicodeTool): ToolDefinition {
  return tool({
    description: core.description,
    args: core.args,
    execute: (args, context) => {
      const progress = context as ProgressContext;
      return core.execute(args, {
        sessionID: context.sessionID,
        progress: (title) => progress.metadata?.({ title }),
      });
    },
  });
}

function createCompactionWaiters(): {
  wait: (sessionID: string) => Promise<void>;
  settle: (sessionID: string, error?: string) => void;
} {
  const pending = new Map<string, Pending>();
  return {
    wait: (sessionID) =>
      new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          pending.delete(sessionID);
          reject(new Error("Compaction timed out"));
        }, config.compaction.timeoutMs);
        pending.set(sessionID, { resolve, reject, timeoutId });
      }),
    settle: (sessionID, error) => {
      const entry = pending.get(sessionID);
      if (!entry) return;
      clearTimeout(entry.timeoutId);
      pending.delete(sessionID);
      if (error) entry.reject(new Error(error));
      else entry.resolve();
    },
  };
}

interface PromptBody {
  readonly parts: Array<{ type: "text"; text: string }>;
  readonly model?: ModelRef;
  readonly agent?: string;
}

function promptBody(text: string, hint: PromptHint | undefined): PromptBody {
  return {
    parts: [{ type: "text", text }],
    ...(hint?.model ? { model: hint.model } : {}),
    ...(hint?.agent ? { agent: hint.agent } : {}),
  };
}

// eslint-disable-next-line max-lines-per-function
export function createV1Host(client: Client, directory: string): V1Host {
  const query = { directory };
  const waiters = createCompactionWaiters();

  async function messages(sessionID: string): Promise<readonly V1Message[]> {
    const resp = (await client.session.messages({ path: { id: sessionID }, query })) as { data?: V1Message[] };
    return resp.data ?? [];
  }

  async function runAgent(run: AgentRun): Promise<AgentReply> {
    const created = (await client.session.create({
      body: { ...(run.parentID ? { parentID: run.parentID } : {}), ...(run.title ? { title: run.title } : {}) },
      query,
    })) as { data?: { id?: string } };
    const sessionID = created.data?.id;
    if (!sessionID) throw new Error("Failed to create session");
    run.onCreated?.(sessionID);

    await client.session.prompt({
      path: { id: sessionID },
      body: {
        agent: run.agent,
        ...(run.denyTools ? { tools: {} } : {}),
        ...(run.model ? { model: run.model } : {}),
        parts: [{ type: "text", text: run.text }],
      },
      query,
    });
    return { sessionID, text: joinTextParts(lastMessage(await messages(sessionID), ASSISTANT_ROLE)?.parts) };
  }

  async function compact(sessionID: string, model: ModelRef): Promise<string> {
    // Register the waiter BEFORE calling summarize to avoid missing the completion event.
    const done = waiters.wait(sessionID);
    await client.session.summarize({ path: { id: sessionID }, body: model, query });
    await done;
    return joinTextParts(lastMessage(await messages(sessionID), ASSISTANT_ROLE, true)?.parts);
  }

  return {
    runAgent,
    remove: async (sessionID) => {
      await client.session.delete({ path: { id: sessionID } }).catch((_e: unknown) => {
        /* cleanup errors are non-fatal */
      });
    },
    prompt: async (sessionID, text, hint) => {
      await client.session.prompt({ path: { id: sessionID }, body: promptBody(text, hint), query });
    },
    interrupt: async (sessionID) => {
      await client.session.abort({ path: { id: sessionID }, query });
    },
    compact,
    lastUserText: async (sessionID) =>
      joinTextParts(lastMessage(await messages(sessionID), USER_ROLE)?.parts) || undefined,
    notify: async (notification: Notification) => {
      await client.tui.showToast({ body: notification }).catch((_e: unknown) => {
        /* the TUI may not be attached */
      });
    },
    relay: (event) => {
      const summarized = summarizedSession(event);
      if (summarized) {
        waiters.settle(summarized);
        return undefined;
      }
      const normalized = normalize(event);
      if (normalized?.type === SESSION_DELETED) waiters.settle(normalized.sessionID, "Session deleted");
      return normalized;
    },
  };
}
