import type { Hooks, Plugin, PluginInput } from "@opencode-ai/plugin";
import { type ToolDefinition, tool } from "@opencode-ai/plugin/tool";

import { createMicode, type Micode } from "@/micode";
import { mergeMcpServers, mergePluginAgents } from "@/plugin-config";
import type { MicodeTool } from "@/tools/define";
import { config } from "@/utils/config";
import { extractErrorMessage } from "@/utils/errors";

import type { AgentReply, AgentRun, HostEvent, ModelRef, Notification, PromptHint, SessionHost } from "./port";

type Client = PluginInput["client"];
type V1Config = Parameters<NonNullable<Hooks["config"]>>[0];
type V1Command = NonNullable<V1Config["command"]>[string];

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
    execute: (args, context) =>
      core.execute(args, {
        sessionID: context.sessionID,
        progress: (title) => context.metadata({ title }),
      }),
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
  try {
    const started = (await v1.client.session.summarize({
      path: { id: sessionID },
      body: model,
      query: v1.query,
    })) as Response<unknown>;
    if (started.error !== undefined) throw new Error(extractErrorMessage(started.error));
  } catch (error) {
    // Settle the waiter so its timeout cannot reject a promise nobody awaits.
    v1.waiters.settle(sessionID, `Compaction request failed: ${extractErrorMessage(error)}`);
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
    // promptAsync enqueues and returns; the blocking prompt stays reserved for runAgent.
    prompt: async (sessionID, text, hint) => {
      const response = (await client.session.promptAsync({
        path: { id: sessionID },
        body: promptBody(text, hint),
        query: v1.query,
      })) as Response<unknown>;
      if (response.error !== undefined) throw new Error(`Prompt failed: ${extractErrorMessage(response.error)}`);
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

function textOf(parts: ReadonlyArray<{ type: string; text?: string }>): string {
  return parts
    .filter((p) => p.type === "text" && typeof p.text === "string")
    .map((p) => p.text ?? "")
    .join(" ");
}

function recordArgs(args: unknown): Record<string, unknown> | undefined {
  return typeof args === "object" && args !== null ? (args as Record<string, unknown>) : undefined;
}

function toCommands(micode: Micode): Record<string, V1Command> {
  return Object.fromEntries(
    micode.commands.map((c) => [c.name, { description: c.description, agent: c.agent, template: c.template }]),
  );
}

function applyConfig(micode: Micode, cfg: V1Config): void {
  // Allow micode's actions without prompting; a user's own explicit setting still wins, as on v2.
  const allowed: Record<string, "allow"> = Object.fromEntries(micode.allowedActions.map((a) => [a, "allow"]));
  cfg.permission = { ...allowed, ...cfg.permission };

  // Our agents override OpenCode defaults; native agents keep their mode (#41). The primary agent goes last.
  const pluginAgents = mergePluginAgents(cfg.agent, micode.agents);
  cfg.agent = {
    ...cfg.agent,
    ...Object.fromEntries(Object.entries(pluginAgents).filter(([k]) => k !== micode.defaultAgent)),
    [micode.defaultAgent]: pluginAgents[micode.defaultAgent],
  };

  // Keep the plugin's workflow as the entry point; an explicit user default_agent always wins.
  // The SDK's Config type lags the server on this field.
  (cfg as { default_agent?: string }).default_agent ??= micode.defaultAgent;

  cfg.mcp = mergeMcpServers(cfg.mcp, micode.mcpServers);
  cfg.command = { ...cfg.command, ...toCommands(micode) };
}

function hooksFor(micode: Micode, host: V1Host): Hooks {
  const tools: Record<string, ToolDefinition> = Object.fromEntries(
    Object.entries(micode.tools).map(([name, core]) => [name, toV1Tool(core)]),
  );

  return {
    tool: tools,
    config: async (cfg) => applyConfig(micode, cfg),
    "chat.message": async (input, output) => {
      const text = textOf(output.parts);
      await micode.onPrompt({ sessionID: input.sessionID, text, agent: input.agent, model: input.model });
    },
    "chat.params": async (input, output) => {
      output.options = { ...output.options, ...micode.requestOptions(input.sessionID) };
    },
    "experimental.chat.system.transform": async (input, output) => {
      if (!input.sessionID) return;
      const next = await micode.systemPrompt({ sessionID: input.sessionID, system: output.system });
      // OpenCode 1 keeps the array it passed in, so a reassigned array would be ignored.
      output.system.splice(0, output.system.length, ...next);
    },
    "experimental.session.compacting": async (input, output) => {
      output.prompt = micode.compactionInstruction(input.sessionID);
    },
    "tool.execute.after": async (input, output) => {
      const args: unknown = input.args;
      output.output = await micode.onToolResult({
        tool: input.tool,
        sessionID: input.sessionID,
        args: recordArgs(args),
        output: output.output,
      });
    },
    event: async ({ event }) => {
      const normalized = host.relay(event);
      if (normalized) await micode.onEvent(normalized);
    },
    dispose: () => micode.dispose(),
  };
}

/** The v1 plugin entry: assembles the core over a v1 session host and exposes it as v1 hooks. */
export const server: Plugin = async ({ client, directory }) => {
  const host = createV1Host(client, directory);
  const micode = await createMicode({ directory, host });
  return hooksFor(micode, host);
};
