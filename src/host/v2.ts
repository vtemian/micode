import { resolve } from "node:path";

import type { Plugin } from "@opencode/plugin";
import type { AgentEditor } from "@opencode/plugin/promise/agent";
import type { MCPEditor } from "@opencode/plugin/promise/mcp";
import type { SessionContext } from "@opencode/plugin/promise/session";
import type { Info as ToolInfo } from "@opencode/plugin/promise/tool";
import type { AgentConfig, McpLocalConfig } from "@opencode-ai/sdk";
import { z } from "zod";

import { createMicode, type Micode } from "@/micode";
import type { MicodeTool } from "@/tools/define";
import { config } from "@/utils/config";
import { extractErrorMessage } from "@/utils/errors";
import { log } from "@/utils/logger";

import type { AgentReply, AgentRun, HostEvent, ModelRef, SessionHost } from "./port";

/** The slice of the v2 plugin context micode uses. Tests fake exactly this. */
export type V2Host = Pick<Plugin.Context, "location" | "tool" | "agent" | "command" | "mcp" | "event" | "session">;

/** The slice the session host needs: the session API and the event stream compaction reports on. */
export type SessionEvents = Pick<V2Host, "session" | "event">;

export interface V2HostOptions {
  readonly compactionTimeoutMs?: number;
}

/** v2 permission vocabulary for a run that may not call tools (reviewer, probe). */
export const DENY_ALL_TOOLS = [{ action: "*", resource: "*", effect: "deny" }] as const;

type Session = V2Host["session"];
type Events = V2Host["event"];
type AgentRecord = Parameters<Parameters<AgentEditor["update"]>[1]>[0];
type V2ModelRef = NonNullable<AgentRecord["model"]>;
type Rule = AgentRecord["permissions"][number];
type V2Tool = ToolInfo<z.ZodObject<z.ZodRawShape>, undefined>;
type McpServer = Parameters<MCPEditor["set"]>[1];
type SessionMessage = Awaited<ReturnType<Session["context"]>>[number];
type AssistantReply = Extract<SessionMessage, { type: "assistant" }>;
type ReplyPart = AssistantReply["content"][number];
type SystemPart = SessionContext["system"][number];
type ContextMessage = SessionContext["messages"][number];
type ParseModel = (ref: string) => V2ModelRef;
type Extras = z.infer<typeof extras>;

const LOG_SCOPE = "host";
const ANY = "*";
const TEXT = "text";
const USER_ROLE = "user";
const ARGUMENTS_PLACEHOLDER = "$ARGUMENTS";
const ANTHROPIC = "anthropic";
const SESSION_DELETED = "session.deleted";
const STEP_ENDED = "session.step.ended";
const EXECUTION_FAILED = "session.execution.failed";

const envelope = z.object({ type: z.string() });
/** `Event.Payload.location` (the project the event belongs to); absent on server-wide events. */
const located = z.object({ location: z.object({ directory: z.string() }) });
const sessionDeleted = z.object({ data: z.object({ sessionID: z.string() }) });
const stepEnded = z.object({
  data: z.object({
    sessionID: z.string(),
    tokens: z.object({ input: z.number(), cache: z.object({ read: z.number() }) }),
  }),
});
const executionFailed = z.object({ data: z.object({ sessionID: z.string(), error: z.unknown() }) });
const compactionEnded = z.object({
  type: z.literal("session.compaction.ended"),
  data: z.object({ sessionID: z.string(), text: z.string() }),
});
const compactionFailed = z.object({
  type: z.literal("session.compaction.failed"),
  data: z.object({ sessionID: z.string(), error: z.object({ message: z.string() }) }),
});
const toolArgs = z.record(z.string(), z.unknown());

/** How OpenCode 2.0.31 serializes turns into a compaction's `recent` text (newline-joined lines). */
const RECENT_USER = "[User]: ";
const RECENT_LINE = /\n\[(?:User|Assistant|Tool|Attached|Skill)/;

const effect = z.enum(["allow", "deny", "ask"]);
/** v1 AgentConfig types none of these; micode's agent configs carry them through its index signature. */
const extras = z.object({
  variant: z.string().optional(),
  thinking: z.unknown().optional(),
  maxTokens: z.number().optional(),
  steps: z.number().optional(),
  tools: z.record(z.string(), z.boolean()).optional(),
  permission: z.record(z.string(), z.union([effect, z.record(z.string(), effect)])).optional(),
});

function isAssistant(message: SessionMessage): message is AssistantReply {
  return message.type === "assistant";
}

function isText(part: ReplyPart): part is Extract<ReplyPart, { type: "text" }> {
  return part.type === TEXT;
}

/** Only a completed, error-free turn counts (mirrors octto and the host's own subagent reader). */
export function lastAssistantText(messages: readonly SessionMessage[]): string {
  const reply = messages
    .filter(isAssistant)
    .filter((m) => m.time.completed !== undefined)
    .at(-1);
  if (!reply) throw new Error("Agent returned no completed reply");
  if (reply.error) throw new Error(`Agent failed: ${reply.error.message}`);
  return reply.content
    .filter(isText)
    .map((part) => part.text)
    .join("\n");
}

/**
 * Resolves with the summary from this session's `session.compaction.ended`, and rejects on its
 * `session.compaction.failed` (a failed compaction must reject like v1 does, never resolve empty).
 */
async function compactionOutcome(events: Events, sessionID: string, signal: AbortSignal): Promise<string> {
  for await (const event of events.subscribe({ signal })) {
    const ended = compactionEnded.safeParse(event);
    if (ended.success && ended.data.data.sessionID === sessionID) return ended.data.data.text;
    const failed = compactionFailed.safeParse(event);
    if (failed.success && failed.data.data.sessionID === sessionID) {
      throw new Error(`Compaction failed: ${failed.data.data.error.message}`);
    }
  }
  throw new Error("Compaction outcome never arrived");
}

/**
 * v2 queues compaction for the next step boundary and resumes the turn itself afterwards, so
 * waiting for idle would only return once the agent stopped. A manual compaction that gets
 * interrupted emits no outcome at all (2.0.31), hence the timeout.
 */
async function compact(host: SessionEvents, sessionID: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  // Subscribe before requesting, so a fast outcome cannot slip past.
  const outcome = compactionOutcome(host.event, sessionID, controller.signal).catch((error: unknown) => {
    if (!controller.signal.aborted) throw error;
    throw new Error(`Compaction did not finish within ${timeoutMs}ms`);
  });
  try {
    const [, summary] = await Promise.all([host.session.compact({ sessionID }), outcome]);
    return summary;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

type Compaction = Extract<SessionMessage, { type: "compaction"; status: "completed" }>;

function isCompleted(message: SessionMessage): message is Compaction {
  return message.type === "compaction" && message.status === "completed";
}

/** The last `[User]: ` turn in a compaction's serialized recent context, up to the next transcript line. */
function recentUserText(recent: string): string | undefined {
  const start = recent.lastIndexOf(RECENT_USER);
  if (start === -1) return undefined;
  const rest = recent.slice(start + RECENT_USER.length);
  const end = rest.search(RECENT_LINE);
  return (end === -1 ? rest : rest.slice(0, end)) || undefined;
}

/** session.context starts at the last completed compaction, so after one there may be no user row yet. */
function lastUserText(messages: readonly SessionMessage[]): string | undefined {
  const user = messages.filter((m) => m.type === USER_ROLE).at(-1);
  if (user) return "text" in user && typeof user.text === "string" ? user.text || undefined : undefined;
  const compaction = messages.filter(isCompleted).at(-1);
  return compaction ? recentUserText(compaction.recent) : undefined;
}

/** The session API takes a plain ref; only agent records need the branded `Model.Ref`. */
function toSessionModel(model: ModelRef): { providerID: string; id: string } {
  return { providerID: model.providerID, id: model.modelID };
}

async function runAgent(session: Session, run: AgentRun): Promise<AgentReply> {
  const { id: sessionID } = await session.create({
    agent: run.agent,
    ...(run.title ? { title: run.title } : {}),
    ...(run.parentID ? { parentID: run.parentID } : {}),
    ...(run.model ? { model: toSessionModel(run.model) } : {}),
    ...(run.denyTools ? { permissions: [...DENY_ALL_TOOLS] } : {}),
  });
  run.onCreated?.(sessionID);
  // v2 prompts enqueue and return at once; wait() blocks until the reply is complete.
  await session.prompt({ sessionID, text: run.text });
  await session.wait({ sessionID });
  return { sessionID, text: lastAssistantText(await session.context({ sessionID })) };
}

export function createV2Host(
  host: SessionEvents,
  { compactionTimeoutMs = config.compaction.timeoutMs }: V2HostOptions = {},
): SessionHost {
  const { session } = host;
  return {
    runAgent: (run) => runAgent(session, run),
    remove: async (sessionID) => {
      try {
        await session.remove({ sessionID });
      } catch (error: unknown) {
        log.warn(LOG_SCOPE, `failed to remove session ${sessionID}: ${extractErrorMessage(error)}`);
      }
    },
    // v2 prompts carry no agent/model; the session already has both, so the hint is ignored.
    prompt: async (sessionID, text) => {
      await session.prompt({ sessionID, text });
    },
    interrupt: async (sessionID) => {
      await session.interrupt({ sessionID });
    },
    compact: (sessionID) => compact(host, sessionID, compactionTimeoutMs),
    lastUserText: async (sessionID) => lastUserText(await session.context({ sessionID })),
    notify: async (notification) => {
      // No server-side toast on v2; a TUI subplugin is a follow-up.
      log.info(LOG_SCOPE, `${notification.title}: ${notification.message}`);
    },
  };
}

function toV2Tool(name: string, core: MicodeTool): V2Tool {
  return {
    name,
    description: core.description,
    input: z.object(core.args),
    // Verified on 2.0.31 (octto): tools default to Code Mode only, and the agent
    // prompts call these by name, so they must be listed as direct function tools.
    options: { codemode: false },
    execute: async (input: unknown, context) => ({
      content: await core.execute(input, {
        sessionID: context.sessionID,
        progress: (title) => void context.progress({ title }),
      }),
    }),
  };
}

function extrasOf(config: AgentConfig): Extras {
  const parsed = extras.safeParse(config);
  if (parsed.success) return parsed.data;
  log.warn(LOG_SCOPE, `ignoring unreadable agent fields: ${parsed.error.message}`);
  return {};
}

const EDIT_ACTION = "edit";

/**
 * v1 permission keys and tool names that OpenCode 2 calls something else. Verified against the
 * 2.0.31 binary: the shell and subagent actions, and the write, edit and patch tools all
 * declaring `permission: "edit"` (no tool ever asserts a "write" action).
 */
const V2_ACTIONS: Readonly<Record<string, string>> = {
  bash: "shell",
  task: "subagent",
  write: EDIT_ACTION,
  patch: EDIT_ACTION,
  multiedit: EDIT_ACTION,
};

/** v1 hid these tools one by one; v2 gates them all through "edit", so only disabling both may deny it. */
const EDIT_TOOLS = ["edit", "write"] as const;

function toV2Action(action: string): string {
  return V2_ACTIONS[action] ?? action;
}

function permissionRules(permission: Extras["permission"]): Rule[] {
  return Object.entries(permission ?? {}).flatMap(([name, rule]) => {
    const action = toV2Action(name);
    return typeof rule === "string"
      ? [{ action, resource: ANY, effect: rule }]
      : Object.entries(rule).map(([resource, ruleEffect]) => ({ action, resource, effect: ruleEffect }));
  });
}

function toolRules(tools: Extras["tools"]): Rule[] {
  const toggles = tools ?? {};
  const editsDisabled = EDIT_TOOLS.every((name) => toggles[name] === false);
  const actions = Object.entries(toggles)
    .filter(([, enabled]) => !enabled)
    .map(([name]) => toV2Action(name))
    .filter((action) => action !== EDIT_ACTION || editsDisabled);
  return [...new Set(actions)].map((action) => ({ action, resource: ANY, effect: "deny" as const }));
}

function isBlanketDeny(rule: Rule, action: string): boolean {
  return rule.action === action && rule.resource === ANY && rule.effect === "deny";
}

/** micode's allow-by-default actions, minus the ones this agent denies outright. */
function allowRules(allowed: readonly string[], own: readonly Rule[]): Rule[] {
  return [...new Set(allowed.map(toV2Action))]
    .filter((action) => !own.some((rule) => isBlanketDeny(rule, action)))
    .map((action) => ({ action, resource: ANY, effect: "allow" as const }));
}

export function toAgentInfo(
  agent: AgentRecord,
  config: AgentConfig,
  model: V2ModelRef | undefined,
  allowed: readonly string[] = [],
): void {
  const extra = extrasOf(config);
  if (config.description !== undefined) agent.description = config.description;
  if (config.mode !== undefined) agent.mode = config.mode;
  if (config.prompt !== undefined) agent.system = config.prompt;
  if (model !== undefined) agent.model = model;
  const steps = extra.steps ?? config.maxSteps;
  if (steps !== undefined) agent.steps = steps;
  // The last matching rule wins on v2. A fresh record starts with `*: allow`, so micode's rules go after it,
  // its allows before the agent's own rules; the host appends the user's global rules after every plugin
  // transform, so those win over everything micode sets.
  const own = [...permissionRules(extra.permission), ...toolRules(extra.tools)];
  agent.permissions.push(...allowRules(allowed, own), ...own);
}

/** A malformed override (no provider prefix, empty) must not stop micode loading; the host default applies. */
function modelRefOf(name: string, config: AgentConfig, parseModel: ParseModel): V2ModelRef | undefined {
  if (config.model === undefined) return undefined;
  const { variant } = extrasOf(config);
  const ref = variant ? `${config.model}#${variant}` : config.model;
  try {
    return parseModel(ref);
  } catch (error: unknown) {
    log.warn(LOG_SCOPE, `agent ${name}: ignoring model "${ref}" (${extractErrorMessage(error)}); using the default`);
    return undefined;
  }
}

async function registerTools(host: V2Host, micode: Micode): Promise<void> {
  await host.tool.transform((editor) => {
    for (const [name, core] of Object.entries(micode.tools)) editor.add(toV2Tool(name, core));
  });
}

export async function registerAgents(
  host: Pick<V2Host, "agent">,
  micode: Pick<Micode, "agents" | "defaultAgent" | "allowedActions">,
  parseModel: ParseModel,
): Promise<void> {
  // Transforms replay synchronously, so resolve branded model refs up front and only assign inside.
  const prepared = Object.entries(micode.agents).map(([name, config]) => ({
    name,
    config,
    model: modelRefOf(name, config, parseModel),
  }));
  await host.agent.transform((editor) => {
    for (const { name, config, model } of prepared) {
      editor.update(name, (agent) => toAgentInfo(agent, config, model, micode.allowedActions));
    }
    editor.default(micode.defaultAgent);
  });
}

async function registerCommands(host: V2Host, micode: Micode): Promise<void> {
  await host.command.transform((editor) => {
    for (const command of micode.commands) {
      editor.add({
        name: command.name,
        description: command.description,
        execute: async ({ sessionID, prompt, delivery }) => {
          await host.session.switchAgent({ sessionID, agent: command.agent });
          await host.session.prompt({
            ...prompt,
            sessionID,
            text: command.template.replace(ARGUMENTS_PLACEHOLDER, prompt.text),
            delivery,
          });
        },
      });
    }
  });
}

function toMcpServer(server: McpLocalConfig): McpServer {
  return {
    type: "local",
    command: [...server.command],
    ...(server.environment ? { environment: server.environment } : {}),
    // Like micode's own tools: the agent prompts call `context7_*` by name, which Code Mode would hide.
    codemode: false,
  };
}

async function registerMcp(host: V2Host, micode: Micode): Promise<void> {
  await host.mcp.transform((editor) => {
    for (const [name, server] of Object.entries(micode.mcpServers)) {
      if (editor.get(name)) continue; // the user's own entry wins, as in v1
      editor.set(name, toMcpServer(server));
    }
  });
}

function textOf(message: ContextMessage): string {
  return message.content
    .map((part) => (part.type === TEXT ? part.text : ""))
    .filter(Boolean)
    .join(" ");
}

/** Keeps the host's own parts (and their cache hints); only micode's additions are plain text. */
function toSystemParts(original: readonly SystemPart[], texts: readonly string[]): SystemPart[] {
  return texts.map((text) => original.find((part) => part.text === text) ?? { type: TEXT, text });
}

/** v2 never applies `agent.request.body`, so per-agent generation settings ride on each request's options. */
function generationOptions(micode: Micode, agent: string, providerID: string): Record<string, unknown> {
  if (!Object.hasOwn(micode.agents, agent)) return {};
  const config = micode.agents[agent];
  const { maxTokens, thinking } = extrasOf(config);
  return {
    ...(config.temperature === undefined ? {} : { temperature: config.temperature }),
    ...(maxTokens === undefined ? {} : { maxTokens }),
    ...(thinking !== undefined && providerID === ANTHROPIC ? { thinking } : {}),
  };
}

async function applyContext(micode: Micode, input: SessionContext): Promise<void> {
  micode.onRequest({
    sessionID: input.sessionID,
    agent: input.agent,
    model: { providerID: input.model.providerID, modelID: input.model.id },
  });
  const lastUser = [...input.messages].reverse().find((m) => m.role === USER_ROLE);
  const system = await micode.systemPrompt({
    sessionID: input.sessionID,
    agent: input.agent,
    system: input.system.map((part) => part.text),
    userText: lastUser ? textOf(lastUser) : undefined,
  });
  input.system.splice(0, input.system.length, ...toSystemParts(input.system, system));
  Object.assign(
    input.options,
    generationOptions(micode, input.agent, input.model.providerID),
    micode.requestOptions(input.sessionID),
  );
}

async function registerSessionHooks(host: V2Host, micode: Micode): Promise<void> {
  await host.session.hook("prompt", async (input) => {
    await micode.onPrompt({ sessionID: input.sessionID, text: input.prompt.text });
  });
  await host.session.hook("context", (input) => applyContext(micode, input));
  await host.session.hook("compaction", (input) => {
    // The compaction hook has no prompt field; the instruction rides on the system prompt.
    input.system.push({ type: TEXT, text: micode.compactionInstruction(input.sessionID) });
  });
}

/**
 * OpenCode 2's read/write/edit take `path` (project-relative or absolute; verified on 2.0.31), while
 * micode's file trackers read v1's absolute `filePath`. The original keys are kept alongside.
 */
function toV1Args(args: unknown, directory: string): Record<string, unknown> | undefined {
  const parsed = toolArgs.safeParse(args);
  if (!parsed.success) return undefined;
  const { path, filePath } = parsed.data;
  if (typeof path !== "string" || filePath !== undefined) return parsed.data;
  return { ...parsed.data, filePath: resolve(directory, path) };
}

async function registerToolHook(host: V2Host, micode: Micode): Promise<void> {
  await host.tool.hook("execute.after", async (input) => {
    if (input.status !== "completed" || typeof input.result.content !== "string") return;
    // ConstraintViolationError cannot abort the call on v2 (after-hook rejections are swallowed);
    // the reviewer has already appended the violation text to the output before it throws.
    try {
      const content = await micode.onToolResult({
        tool: input.tool,
        sessionID: input.sessionID,
        args: toV1Args(input.input, host.location.directory),
        output: input.result.content,
      });
      input.result = { ...input.result, content };
    } catch (error: unknown) {
      log.warn(LOG_SCOPE, `tool post-processing failed for ${input.tool}: ${extractErrorMessage(error)}`);
    }
  });
}

function deletedOf(event: unknown): HostEvent | undefined {
  const parsed = sessionDeleted.safeParse(event);
  return parsed.success ? { type: SESSION_DELETED, sessionID: parsed.data.data.sessionID } : undefined;
}

function usageOf(event: unknown): HostEvent | undefined {
  const parsed = stepEnded.safeParse(event);
  if (!parsed.success) return undefined;
  const { sessionID, tokens } = parsed.data.data;
  return { type: "assistant.usage", sessionID, input: tokens.input, cacheRead: tokens.cache.read };
}

function errorOf(event: unknown): HostEvent | undefined {
  const parsed = executionFailed.safeParse(event);
  return parsed.success
    ? { type: "session.error", sessionID: parsed.data.data.sessionID, error: parsed.data.data.error }
    : undefined;
}

/** Maps the v2 events micode cares about onto the host event union; anything else is dropped. */
export function normalizeEvent(event: unknown): HostEvent | undefined {
  const typed = envelope.safeParse(event);
  if (!typed.success) return undefined;
  if (typed.data.type === SESSION_DELETED) return deletedOf(event);
  if (typed.data.type === STEP_ENDED) return usageOf(event);
  if (typed.data.type === EXECUTION_FAILED) return errorOf(event);
  return undefined;
}

/** One shared server hosts a micode instance per project and the stream is not project-scoped. */
function isForeign(event: unknown, directory: string): boolean {
  const parsed = located.safeParse(event);
  return parsed.success && parsed.data.location.directory !== directory;
}

async function relayEvents(host: V2Host, micode: Micode, signal: AbortSignal): Promise<void> {
  for await (const event of host.event.subscribe({ signal })) {
    if (isForeign(event, host.location.directory)) continue;
    const normalized = normalizeEvent(event);
    if (!normalized) continue;
    try {
      await micode.onEvent(normalized);
    } catch (error: unknown) {
      // One bad event must not end the subscription for the plugin's lifetime.
      log.error(LOG_SCOPE, `event handling failed: ${extractErrorMessage(error)}`);
    }
  }
}

function watchEvents(host: V2Host, micode: Micode): () => void {
  const controller = new AbortController();
  void relayEvents(host, micode, controller.signal).catch((error: unknown) => {
    if (controller.signal.aborted) return;
    log.error(LOG_SCOPE, `event stream ended unexpectedly: ${extractErrorMessage(error)}`);
  });
  return () => controller.abort();
}

/** The v2 plugin entry: assembles the core over a v2 session host and registers it on the context. */
export async function setup(host: V2Host): Promise<Plugin.Cleanup> {
  // Dynamic on purpose: the v1 host must never load the v2 SDK.
  const { Model } = await import("@opencode/plugin");
  const parseModel: ParseModel = (ref) => Model.Ref.parse(ref);
  const micode = await createMicode({
    directory: host.location.directory,
    host: createV2Host(host),
  });

  try {
    await registerTools(host, micode);
    await registerAgents(host, micode, parseModel);
    await registerCommands(host, micode);
    await registerMcp(host, micode);
    await registerSessionHooks(host, micode);
    await registerToolHook(host, micode);
  } catch (error) {
    // A half-registered plugin must not keep PTY and octto state alive.
    await micode.dispose();
    throw error;
  }
  const stopWatching = watchEvents(host, micode);

  return async () => {
    stopWatching();
    await micode.dispose();
  };
}
