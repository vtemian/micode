import type { PluginInput } from "@opencode-ai/plugin";
import { type ToolDefinition, tool } from "@opencode-ai/plugin/tool";

import type { MicodeTool } from "@/tools/define";
import { config } from "@/utils/config";
import { extractErrorMessage } from "@/utils/errors";

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
  readonly time?: { readonly completed?: number };
}

interface V1Message {
  readonly info?: MessageInfo;
  readonly parts?: readonly Part[];
}

/** The v1 client never throws on HTTP errors; it returns `{ data }` or `{ error }`. */
interface Response<T> {
  readonly data?: T;
  readonly error?: unknown;
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

interface CompactionWaiters {
  wait(sessionID: string): Promise<void>;
  settle(sessionID: string, error?: string): void;
}

interface V1Context {
  readonly client: Client;
  readonly query: { readonly directory: string };
  readonly waiters: CompactionWaiters;
}

/** v1 tool contexts carry an undocumented `metadata({ title })` used for progress. */
interface ProgressContext {
  readonly sessionID?: string;
  readonly metadata?: (input: { title?: string }) => void;
}

const USER_ROLE = "user";
const ASSISTANT_ROLE = "assistant";
const MESSAGE_UPDATED = "message.updated";
const SESSION_COMPACTED = "session.compacted";
const SESSION_ERROR = "session.error";
const SESSION_DELETED = "session.deleted";

export function joinTextParts(parts: readonly Part[] | undefined): string {
  return (parts ?? [])
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");
}

function unwrap<T>(response: Response<T>, what: string): T {
  if (response.error !== undefined) throw new Error(`${what}: ${extractErrorMessage(response.error)}`);
  if (response.data === undefined) throw new Error(`${what}: empty response`);
  return response.data;
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
  // A summary's token count is the pre-compaction context size; it must not re-trigger compaction.
  if (info.summary === true) return undefined;
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

/**
 * Settles a pending compaction. v1 fires `session.compacted` once the summary is
 * written; a summary message that carries an error fails the compaction instead.
 */
function settleCompaction(waiters: CompactionWaiters, event: V1Event): void {
  const props = propertiesOf(event);
  if (event.type === SESSION_COMPACTED && typeof props.sessionID === "string") {
    waiters.settle(props.sessionID);
    return;
  }
  if (event.type !== MESSAGE_UPDATED) return;
  const info = props.info as MessageInfo | undefined;
  if (info?.role !== ASSISTANT_ROLE || info.summary !== true || !info.sessionID) return;
  if (info.error) waiters.settle(info.sessionID, `Compaction failed: ${extractErrorMessage(info.error)}`);
  else if (info.time?.completed !== undefined) waiters.settle(info.sessionID);
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

function createCompactionWaiters(): CompactionWaiters {
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
  readonly tools?: Record<string, boolean>;
}

function promptBody(text: string, hint: PromptHint | undefined, denyTools = false): PromptBody {
  return {
    parts: [{ type: "text", text }],
    ...(hint?.model ? { model: hint.model } : {}),
    ...(hint?.agent ? { agent: hint.agent } : {}),
    ...(denyTools ? { tools: {} } : {}),
  };
}

async function messages(v1: V1Context, sessionID: string): Promise<readonly V1Message[]> {
  const response = (await v1.client.session.messages({ path: { id: sessionID }, query: v1.query })) as Response<
    V1Message[]
  >;
  return unwrap(response, "Failed to read session messages");
}

async function runAgent(v1: V1Context, run: AgentRun): Promise<AgentReply> {
  const created = (await v1.client.session.create({
    body: { ...(run.parentID ? { parentID: run.parentID } : {}), ...(run.title ? { title: run.title } : {}) },
    query: v1.query,
  })) as Response<{ id?: string }>;
  const sessionID = unwrap(created, "Failed to create session").id;
  if (!sessionID) throw new Error("Failed to create session: no id");
  run.onCreated?.(sessionID);

  // v1 prompts block until the reply is complete and return it, so no second read is needed.
  const replied = (await v1.client.session.prompt({
    path: { id: sessionID },
    body: promptBody(run.text, { model: run.model, agent: run.agent }, run.denyTools),
    query: v1.query,
  })) as Response<V1Message>;
  const reply = unwrap(replied, "Agent prompt failed");
  if (reply.info?.error) throw new Error(`Agent failed: ${extractErrorMessage(reply.info.error)}`);
  return { sessionID, text: joinTextParts(reply.parts) };
}

async function compact(v1: V1Context, sessionID: string, model: ModelRef): Promise<string> {
  // Register the waiter BEFORE calling summarize to avoid missing the completion event.
  const done = v1.waiters.wait(sessionID);
  const started = (await v1.client.session.summarize({
    path: { id: sessionID },
    body: model,
    query: v1.query,
  })) as Response<unknown>;
  if (started.error !== undefined) {
    v1.waiters.settle(sessionID, `Compaction request failed: ${extractErrorMessage(started.error)}`);
  }
  await done;
  return joinTextParts(lastMessage(await messages(v1, sessionID), ASSISTANT_ROLE, true)?.parts);
}

export function createV1Host(client: Client, directory: string): V1Host {
  const v1: V1Context = { client, query: { directory }, waiters: createCompactionWaiters() };

  return {
    runAgent: (run) => runAgent(v1, run),
    remove: async (sessionID) => {
      await client.session.delete({ path: { id: sessionID }, query: v1.query }).catch((_e: unknown) => {
        /* cleanup errors are non-fatal */
      });
    },
    prompt: async (sessionID, text, hint) => {
      const response = (await client.session.prompt({
        path: { id: sessionID },
        body: promptBody(text, hint),
        query: v1.query,
      })) as Response<unknown>;
      unwrap(response, "Prompt failed");
    },
    interrupt: async (sessionID) => {
      const response = (await client.session.abort({ path: { id: sessionID }, query: v1.query })) as Response<unknown>;
      if (response.error !== undefined) throw new Error(`Abort failed: ${extractErrorMessage(response.error)}`);
    },
    compact: (sessionID, model) => compact(v1, sessionID, model),
    lastUserText: async (sessionID) =>
      joinTextParts(lastMessage(await messages(v1, sessionID), USER_ROLE)?.parts) || undefined,
    notify: async (notification: Notification) => {
      await client.tui.showToast({ body: notification }).catch((_e: unknown) => {
        /* the TUI may not be attached */
      });
    },
    relay: (event) => {
      settleCompaction(v1.waiters, event);
      const normalized = normalize(event);
      if (normalized?.type === SESSION_DELETED) v1.waiters.settle(normalized.sessionID, "Session deleted");
      return normalized;
    },
  };
}
