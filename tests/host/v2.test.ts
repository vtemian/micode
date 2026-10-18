import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agents } from "../../src/agents";
import {
  createV2Host,
  DENY_ALL_TOOLS,
  lastAssistantText,
  normalizeEvent,
  registerAgents,
  setup,
  toAgentInfo,
  type V2Host,
} from "../../src/host/v2";
import type { Micode } from "../../src/micode";
import { captureLogs, type LogCapture } from "../helpers/log-capture";

type Any = Record<string, any>;

const MODEL = { providerID: "p", modelID: "m" };
const NOTE = { title: "T", message: "M", variant: "info" as const, duration: 1 };

/** `Agent.Info.default(id)` rules, copied verbatim from the OpenCode 2.0.31 binary. */
const HOST_DEFAULT_RULES = [
  { action: "*", resource: "*", effect: "allow" },
  { action: "read", resource: "*.env", effect: "ask" },
  { action: "read", resource: "*.env.*", effect: "ask" },
  { action: "read", resource: "*.env.example", effect: "allow" },
] as const;

function blankAgent(id: string): Any {
  return {
    id,
    name: id,
    request: { settings: {}, headers: {}, body: {} },
    mode: "primary",
    hidden: false,
    permissions: HOST_DEFAULT_RULES.map((rule) => ({ ...rule })),
  };
}

/** The rules micode appended after the host's defaults. */
function added(agent: Any): Any[] {
  return agent.permissions.slice(HOST_DEFAULT_RULES.length);
}

/** OpenCode 2.0.31's wildcard matcher (`rN`). */
function wildcard(value: string, pattern: string): boolean {
  let source = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  if (source.endsWith(" .*")) source = `${source.slice(0, -3)}( .*)?`;
  return new RegExp(`^${source}$`, "s").test(value);
}

/** OpenCode 2.0.31's evaluator (`O5`): the last matching rule wins, and no match means "ask". */
function evaluate(rules: readonly Any[], action: string, resource: string): string {
  return rules.findLast((rule) => wildcard(action, rule.action) && wildcard(resource, rule.resource))?.effect ?? "ask";
}

/** What the host's config plugin does after every plugin transform: push the user's global rules. */
function withGlobals(agent: Any, globals: readonly Any[]): Any[] {
  return [...agent.permissions, ...globals];
}

function parseModel(ref: string): any {
  const [providerID, rest] = ref.split("/");
  const [id, variant] = rest.split("#");
  return variant ? { providerID, id, variant } : { providerID, id };
}

function createHost(directory = "/tmp/micode-v2-test") {
  const tools = new Map<string, Any>();
  const agents = new Map<string, Any>();
  const commands = new Map<string, Any>();
  const mcp = new Map<string, Any>();
  const hooks = new Map<string, (input: Any) => Promise<void> | void>();
  let defaultAgent: string | undefined;
  const queue: Any[] = [];
  let push: (() => void) | undefined;
  const sessions = {
    created: [] as Any[],
    prompted: [] as Any[],
    switched: [] as Any[],
    waited: [] as string[],
    removed: [] as string[],
    compacted: [] as string[],
    interrupted: [] as string[],
  };
  const registration = { dispose: async () => {} };

  const host = {
    location: { directory },
    tool: {
      transform: async (edit: (e: Any) => void) => {
        edit({ add: (t: Any) => tools.set(t.name, t) });
        return registration;
      },
      hook: async (name: string, cb: (i: Any) => Promise<void> | void) => {
        hooks.set(`tool.${name}`, cb);
        return registration;
      },
    },
    agent: {
      transform: async (edit: (e: Any) => void) => {
        edit({
          default: (id: string) => {
            defaultAgent = id;
          },
          update: (id: string, mutate: (a: Any) => void) => {
            const a = agents.get(id) ?? blankAgent(id);
            mutate(a);
            agents.set(id, a);
          },
        });
        return registration;
      },
    },
    command: {
      transform: async (edit: (e: Any) => void) => {
        edit({ add: (c: Any) => commands.set(c.name, c) });
        return registration;
      },
    },
    mcp: {
      transform: async (edit: (e: Any) => void) => {
        edit({ get: (n: string) => mcp.get(n), set: (n: string, c: Any) => mcp.set(n, c) });
        return registration;
      },
    },
    permission: {
      hook: async (name: string, cb: (i: Any) => Promise<void> | void) => {
        hooks.set(`permission.${name}`, cb);
        return registration;
      },
    },
    session: {
      hook: async (name: string, cb: (i: Any) => Promise<void> | void) => {
        hooks.set(`session.${name}`, cb);
        return registration;
      },
      create: async (i: Any) => {
        sessions.created.push(i);
        return { id: "ses_child" };
      },
      prompt: async (i: Any) => {
        sessions.prompted.push(i);
        return {};
      },
      switchAgent: async (i: Any) => {
        sessions.switched.push(i);
      },
      wait: async ({ sessionID }: Any) => {
        sessions.waited.push(sessionID);
      },
      interrupt: async ({ sessionID }: Any) => {
        sessions.interrupted.push(sessionID);
        return { interrupted: true };
      },
      compact: async ({ sessionID }: Any) => {
        sessions.compacted.push(sessionID);
        return {};
      },
      remove: async ({ sessionID }: Any) => {
        sessions.removed.push(sessionID);
      },
      context: async () => [
        { type: "user", text: "question" },
        {
          type: "assistant",
          time: { created: 1, completed: 2 },
          content: [
            { type: "reasoning", text: "hmm" },
            { type: "text", text: "answer" },
          ],
        },
        { type: "compaction", status: "completed", summary: "the summary" },
      ],
    },
    event: {
      // Events are queued so two back-to-back emits both reach the consumer.
      subscribe: ({ signal }: { signal: AbortSignal }) => ({
        async *[Symbol.asyncIterator]() {
          while (!signal.aborted) {
            if (queue.length === 0) {
              await new Promise<void>((resolve) => {
                push = resolve;
                signal.addEventListener("abort", () => resolve(), { once: true });
              });
            }
            if (signal.aborted) return;
            const event = queue.shift();
            if (event !== undefined) yield event;
          }
        },
      }),
    },
  };
  return {
    host: host as unknown as V2Host,
    tools,
    agents,
    commands,
    mcp,
    hooks,
    sessions,
    defaultAgent: () => defaultAgent,
    emit: (e: Any) => {
      queue.push(e);
      push?.();
    },
  };
}

/** Removes the lines a test expected so the afterEach pristine-output check only sees surprises. */
function drain(lines: string[], pattern: RegExp): string[] {
  const taken = lines.filter((l) => pattern.test(l));
  for (const line of taken) lines.splice(lines.indexOf(line), 1);
  return taken;
}

async function waitUntil(condition: () => Promise<boolean>, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("condition not met in time");
}

const STARTUP_PROBES = /ast-grep|btca|pty\.loader|BUN_PTY/i;

describe("v2 setup", () => {
  let cleanup: (() => Promise<void> | void) | undefined;
  let logs: LogCapture;
  beforeEach(() => {
    logs = captureLogs();
  });
  afterEach(async () => {
    await cleanup?.();
    cleanup = undefined;
    // Startup probes for ast-grep/btca/bun-pty log their findings; nothing else may.
    const unexpected = [...logs.warn, ...logs.info].filter((l) => !STARTUP_PROBES.test(l));
    logs.restore();
    expect(unexpected).toEqual([]);
    expect(logs.unread()).toEqual([]);
  });

  it("registers tools with a standard-schema input and string content", async () => {
    const h = createHost();
    cleanup = await setup(h.host);
    const tool = h.tools.get("batch_read");
    expect(typeof tool?.input["~standard"]).toBe("object");
    expect(tool?.options).toEqual({ codemode: false });
    expect(h.tools.has("spawn_agent")).toBe(true);
    const titles: string[] = [];
    const out = await h.tools
      .get("batch_read")
      ?.execute({ paths: [] }, { sessionID: "s1", progress: async (m: Any) => void titles.push(String(m.title)) });
    expect(typeof out.content).toBe("string");
  });

  it("upserts the agents, sets the default and maps v1 fields", async () => {
    const h = createHost();
    cleanup = await setup(h.host);
    const commander = h.agents.get("commander");
    expect(h.defaultAgent()).toBe("commander");
    expect(commander?.mode).toBe("primary");
    expect(typeof commander?.system).toBe("string");
    // The user's own micode.json may override the model; only the branded-ref shape is micode's.
    expect(commander?.model).toMatchObject({ providerID: expect.any(String), id: expect.any(String) });
    // OpenCode 2 never applies agent.request.body; generation settings travel through the context hook.
    expect(commander?.request.body).toEqual({});
    expect(commander?.permissions).toEqual(
      expect.arrayContaining([{ action: "spawn_agent", resource: "*", effect: "deny" }]),
    );
  });

  it("registers commands that switch the agent and prompt with the template", async () => {
    const h = createHost();
    cleanup = await setup(h.host);
    await h.commands.get("ledger")?.execute({ sessionID: "s1", prompt: { text: "please" }, delivery: "queue" });
    expect(h.sessions.switched).toEqual([{ sessionID: "s1", agent: "ledger-creator" }]);
    expect(h.sessions.prompted[0]).toMatchObject({
      sessionID: "s1",
      text: "Update the continuity ledger. please",
      delivery: "queue",
    });
  });

  it("adds mcp servers the user has not configured", async () => {
    const h = createHost();
    h.mcp.set("context7", { type: "local", command: ["mine"] });
    cleanup = await setup(h.host);
    expect(h.mcp.get("context7")).toEqual({ type: "local", command: ["mine"] });
  });

  it("adds mcp servers in the v2 shape", async () => {
    const h = createHost();
    cleanup = await setup(h.host);
    expect(h.mcp.get("context7")).toEqual({ type: "local", command: ["npx", "-y", "@upstash/context7-mcp@latest"] });
  });

  it("allows the micode actions through agent rules, never by rewriting the host's verdict", async () => {
    const h = createHost();
    cleanup = await setup(h.host);
    expect(h.hooks.has("permission.evaluate")).toBe(false);
    const commander = h.agents.get("commander")!;
    for (const action of ["edit", "shell", "webfetch", "external_directory"]) {
      expect([action, evaluate(commander.permissions, action, "*")]).toEqual([action, "allow"]);
    }
  });

  it("leaves a user's global ask in force", async () => {
    const h = createHost();
    cleanup = await setup(h.host);
    const ask = [
      { action: "shell", resource: "*", effect: "ask" },
      { action: "external_directory", resource: "*", effect: "ask" },
    ];
    const rules = withGlobals(h.agents.get("commander")!, ask);
    expect(evaluate(rules, "shell", "rm -rf build")).toBe("ask");
    expect(evaluate(rules, "external_directory", "/elsewhere/a.ts")).toBe("ask");
  });

  it("keeps per-agent denies ahead of micode's allows", async () => {
    const h = createHost();
    cleanup = await setup(h.host);
    const locator = h.agents.get("codebase-locator")!;
    expect(evaluate(locator.permissions, "edit", "/repo/a.ts")).toBe("deny");
    expect(evaluate(locator.permissions, "shell", "ls")).toBe("deny");
    expect(evaluate(locator.permissions, "webfetch", "https://x")).toBe("allow");
    expect(locator.permissions).not.toContainEqual({ action: "edit", resource: "*", effect: "allow" });
    expect(locator.permissions).not.toContainEqual({ action: "shell", resource: "*", effect: "allow" });
  });

  it("filters project instructions and injects request options in the context hook", async () => {
    const h = createHost();
    cleanup = await setup(h.host);
    await h.hooks.get("session.prompt")!({ sessionID: "s1", prompt: { text: "think hard" }, delivery: "queue" });
    const kept = { type: "text", text: "keep", cache: { type: "ephemeral" } };
    const ctx = {
      sessionID: "s1",
      agent: "commander",
      model: { providerID: "p", id: "m" },
      system: [{ type: "text", text: "Instructions from: /x/CLAUDE.md\nno" }, kept],
      messages: [{ role: "user", content: [{ type: "text", text: "think hard" }] }],
      tools: {},
      options: {},
    };
    await h.hooks.get("session.context")!(ctx);
    expect(ctx.system.map((p) => p.text)).not.toContain("Instructions from: /x/CLAUDE.md\nno");
    expect(ctx.system).toContainEqual(kept);
    expect(ctx.options).toMatchObject({ thinking: { type: "enabled" } });
  });

  async function contextOptions(h: ReturnType<typeof createHost>, agent: string, providerID: string): Promise<Any> {
    const ctx: Any = {
      sessionID: `s_${agent}_${providerID}`,
      agent,
      model: { providerID, id: "m" },
      system: [],
      messages: [],
      tools: {},
      options: {},
    };
    await h.hooks.get("session.context")!(ctx);
    return ctx.options;
  }

  it("applies the agent's generation settings, with thinking only on anthropic models", async () => {
    const h = createHost();
    cleanup = await setup(h.host);
    const { temperature, maxTokens, thinking } = agents.commander as Any;
    expect(await contextOptions(h, "commander", "anthropic")).toEqual({ temperature, maxTokens, thinking });
    expect(await contextOptions(h, "commander", "openai")).toEqual({ temperature, maxTokens });
  });

  it("leaves the options alone for agents micode does not own", async () => {
    const h = createHost();
    cleanup = await setup(h.host);
    expect(await contextOptions(h, "build", "anthropic")).toEqual({});
  });

  it("lets the think-keyword budget override the agent's thinking", async () => {
    const h = createHost();
    cleanup = await setup(h.host);
    await h.hooks.get("session.prompt")!({
      sessionID: "s_commander_anthropic",
      prompt: { text: "think hard" },
      delivery: "queue",
    });
    const options = await contextOptions(h, "commander", "anthropic");
    expect(options.thinking).toEqual({ type: "enabled", budgetTokens: expect.any(Number) });
    expect(options.maxTokens).toBe((agents.commander as Any).maxTokens);
  });

  it("pushes the compaction instruction onto the system prompt", async () => {
    const h = createHost();
    cleanup = await setup(h.host);
    const ctx = { sessionID: "s1", system: [] as Any[], messages: [], tools: {}, options: {} };
    await h.hooks.get("session.compaction")!(ctx);
    expect(ctx.system[0].text).toContain("# Session Summary");
  });

  it("post-processes completed tool results and ignores the rest", async () => {
    const h = createHost();
    cleanup = await setup(h.host);
    const after = h.hooks.get("tool.execute.after")!;
    const event = {
      tool: "read",
      sessionID: "s1",
      input: { path: "/x/a.ts" },
      status: "completed",
      result: { content: "body" },
    };
    await after(event);
    expect(event.result.content).toBe("body");
    const parts = {
      tool: "read",
      sessionID: "s1",
      input: {},
      status: "completed",
      result: { content: [{ type: "text", text: "x" }] },
    };
    await after(parts);
    expect(parts.result.content).toEqual([{ type: "text", text: "x" }]);
    const failed = { tool: "read", sessionID: "s1", input: {}, status: "error", error: { message: "boom" } };
    await after(failed);
    expect(failed.error).toEqual({ message: "boom" });
  });

  it("feeds the built-in tools' v2 `path` argument to micode's file trackers", async () => {
    const project = await mkdtemp(join(tmpdir(), "micode-v2-path-"));
    try {
      await mkdir(join(project, "src"));
      await writeFile(join(project, "src", "README.md"), "module notes");
      const h = createHost(project);
      cleanup = await setup(h.host);
      const after = h.hooks.get("tool.execute.after")!;
      // OpenCode 2's read/write/edit take `path`, relative to the project or absolute; never `filePath`.
      const relative = { tool: "read", sessionID: "s1", input: { path: "src/a.ts" }, status: "completed" };
      const withResult = { ...relative, result: { content: "body" } };
      await after(withResult);
      expect(withResult.result.content).toContain("module notes");
      expect(withResult.input).toEqual({ path: "src/a.ts" });
      const absolute = { ...relative, input: { path: join(project, "src", "b.ts") }, result: { content: "body" } };
      await after(absolute);
      expect(absolute.result.content).toContain("module notes");
    } finally {
      await rm(project, { recursive: true, force: true });
    }
  });

  it("logs and keeps the tool result when post-processing throws", async () => {
    const h = createHost();
    cleanup = await setup(h.host);
    const after = h.hooks.get("tool.execute.after")!;
    // An absurdly long grep output under an exhausted context exercises the truncation path; to force a
    // throw we hand the pipeline a result whose content getter explodes.
    const event = {
      tool: "read",
      sessionID: "s1",
      input: { path: "/x/a.ts" },
      status: "completed",
      get result() {
        return { content: "body" };
      },
      set result(_value: unknown) {
        throw new Error("result is sealed");
      },
    };
    await after(event);
    expect(drain(logs.warn, /tool post-processing failed for read: result is sealed/)).toHaveLength(1);
  });

  it("drives session recovery from session.execution.failed and keeps the subscription alive", async () => {
    const h = createHost();
    cleanup = await setup(h.host);
    h.emit({
      type: "session.execution.failed",
      data: { sessionID: "s1", error: { type: "x", message: "content cannot be empty" } },
    });
    await waitUntil(async () => h.sessions.prompted.length === 1);
    expect(h.sessions.interrupted).toEqual(["s1"]);
    expect(h.sessions.prompted[0]).toMatchObject({ sessionID: "s1", text: "Continue from where you left off." });
    // v2 has no toast; the notifications land in the log.
    expect(drain(logs.info, /Session Recovery|Recovery Complete/)).toHaveLength(2);
    // The stream is still being consumed afterwards.
    h.emit({ type: "session.deleted", data: { sessionID: "s1" } });
    h.emit({
      type: "session.execution.failed",
      data: { sessionID: "s1", error: { type: "x", message: "content cannot be empty" } },
    });
    await waitUntil(async () => h.sessions.prompted.length === 2);
    expect(drain(logs.info, /Session Recovery|Recovery Complete/)).toHaveLength(2);
  });

  it("ignores events from other projects on the shared server", async () => {
    const h = createHost();
    cleanup = await setup(h.host);
    const failure = (sessionID: string, directory: string) => ({
      type: "session.execution.failed",
      location: { directory },
      data: { sessionID, error: { type: "x", message: "content cannot be empty" } },
    });
    h.emit(failure("s_other", "/tmp/another-project"));
    h.emit(failure("s_mine", "/tmp/micode-v2-test"));
    await waitUntil(async () => h.sessions.prompted.length === 1);
    expect(h.sessions.interrupted).toEqual(["s_mine"]);
    expect(h.sessions.prompted.map((p) => p.sessionID)).toEqual(["s_mine"]);
    expect(drain(logs.info, /Session Recovery|Recovery Complete/)).toHaveLength(2);
  });

  it("logs when the event stream itself breaks", async () => {
    const h = createHost();
    const broken = {
      ...h.host,
      event: {
        subscribe: () => ({
          [Symbol.asyncIterator]: () => ({
            next: () => Promise.reject(new Error("stream reset")),
          }),
        }),
      },
    } as unknown as V2Host;
    cleanup = await setup(broken);
    await waitUntil(async () => logs.error.some((l) => l.includes("event stream ended unexpectedly")));
    expect(drain(logs.error, /event stream ended unexpectedly: stream reset/)).toHaveLength(1);
  });

  it("relays session.deleted into the core and survives a malformed event", async () => {
    const h = createHost();
    cleanup = await setup(h.host);
    await h.hooks.get("session.prompt")!({ sessionID: "s1", prompt: { text: "think hard" }, delivery: "queue" });
    const context = () => {
      const ctx: Any = {
        sessionID: "s1",
        agent: "a",
        model: { providerID: "p", id: "m" },
        system: [],
        messages: [],
        tools: {},
        options: {},
      };
      return h.hooks.get("session.context")!(ctx).then(() => ctx.options as Any);
    };
    expect(await context()).toMatchObject({ thinking: { type: "enabled" } });

    h.emit({ type: "session.deleted" });
    await new Promise((resolve) => setTimeout(resolve, 10));
    h.emit({
      type: "session.step.ended",
      data: { sessionID: "s1", tokens: { input: 10, output: 1, reasoning: 0, cache: { read: 5, write: 0 } } },
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    h.emit({ type: "session.execution.failed", data: { sessionID: "s1", error: { type: "x", message: "boom" } } });
    await new Promise((resolve) => setTimeout(resolve, 10));
    h.emit({ type: "session.deleted", data: { sessionID: "s1" } });

    await waitUntil(async () => Object.keys(await context()).length === 0);
    expect(logs.error).toEqual([]);
  });
});

describe("registerAgents", () => {
  it("leaves a bad model reference to the host default and still registers every agent", async () => {
    const { Model } = await import("@opencode/plugin");
    const h = createHost();
    const micode = {
      agents: {
        bare: { model: "gpt-5", prompt: "a" },
        empty: { model: "", prompt: "b" },
        good: { model: "openai/gpt-5", variant: "high", prompt: "c" },
      },
      defaultAgent: "good",
      allowedActions: [],
    } as unknown as Micode;
    const logs = captureLogs();
    try {
      await registerAgents(h.host, micode, (ref) => Model.Ref.parse(ref));
      expect([...h.agents.keys()]).toEqual(["bare", "empty", "good"]);
      expect(h.agents.get("bare")?.model).toBeUndefined();
      expect(h.agents.get("empty")?.model).toBeUndefined();
      expect(h.agents.get("good")?.model).toEqual({ providerID: "openai", id: "gpt-5", variant: "high" });
      expect(h.defaultAgent()).toBe("good");
      expect(drain(logs.warn, /agent bare: ignoring model "gpt-5"/)).toHaveLength(1);
      expect(drain(logs.warn, /agent empty: ignoring model ""/)).toHaveLength(1);
      expect(logs.warn).toEqual([]);
      expect(logs.unread()).toEqual([]);
    } finally {
      logs.restore();
    }
  });
});

describe("normalizeEvent", () => {
  it("maps the three v2 events onto the host event union", () => {
    expect(normalizeEvent({ type: "session.deleted", data: { sessionID: "s1" } })).toEqual({
      type: "session.deleted",
      sessionID: "s1",
    });
    expect(
      normalizeEvent({
        type: "session.step.ended",
        data: {
          sessionID: "s1",
          assistantMessageID: "m",
          tokens: { input: 10, output: 1, reasoning: 0, cache: { read: 5, write: 0 } },
        },
      }),
    ).toEqual({ type: "assistant.usage", sessionID: "s1", input: 10, cacheRead: 5 });
    expect(
      normalizeEvent({
        type: "session.execution.failed",
        data: { sessionID: "s1", error: { type: "x", message: "boom" } },
      }),
    ).toEqual({ type: "session.error", sessionID: "s1", error: { type: "x", message: "boom" } });
  });

  it("drops unrelated and malformed events", () => {
    expect(normalizeEvent({ type: "session.idle", data: { sessionID: "s1" } })).toBeUndefined();
    expect(normalizeEvent({ type: "session.deleted" })).toBeUndefined();
    expect(normalizeEvent({ type: "session.step.ended", data: { sessionID: "s1" } })).toBeUndefined();
    expect(normalizeEvent({ type: "session.execution.failed", data: {} })).toBeUndefined();
    expect(normalizeEvent(null)).toBeUndefined();
    expect(normalizeEvent("nope")).toBeUndefined();
  });
});

describe("toAgentInfo", () => {
  it("maps a v1 AgentConfig onto a v2 agent record", () => {
    const agent = blankAgent("x");
    toAgentInfo(
      agent,
      {
        prompt: "sys",
        mode: "subagent",
        description: "d",
        temperature: 0.3,
        maxTokens: 1000,
        maxSteps: 5,
        tools: { write: false, read: true },
        permission: { edit: "deny", bash: "allow" },
      } as any,
      { providerID: "p", id: "m" } as any,
    );
    expect(agent).toMatchObject({
      system: "sys",
      mode: "subagent",
      description: "d",
      steps: 5,
      model: { providerID: "p", id: "m" },
    });
    expect(agent.request.body).toEqual({});
    // `write: false` alone maps to nothing: v2 has no "write" action and governs writes through "edit".
    expect(added(agent)).toEqual([
      { action: "edit", resource: "*", effect: "deny" },
      { action: "shell", resource: "*", effect: "allow" },
    ]);
  });

  it("expands per-command bash rules into resource patterns", () => {
    const agent = blankAgent("x");
    toAgentInfo(agent, { permission: { bash: { "git *": "allow", "rm *": "deny" } } } as any, undefined);
    expect(added(agent)).toEqual([
      { action: "shell", resource: "git *", effect: "allow" },
      { action: "shell", resource: "rm *", effect: "deny" },
    ]);
  });

  it("puts micode's rules after the host defaults so its denies beat the default allow", () => {
    const agent = blankAgent("x");
    toAgentInfo(agent, { permission: { edit: "deny" }, tools: { bash: false } }, undefined);
    expect(agent.permissions.slice(0, HOST_DEFAULT_RULES.length)).toEqual([...HOST_DEFAULT_RULES]);
    expect(evaluate(agent.permissions, "edit", "/repo/src/a.ts")).toBe("deny");
    expect(evaluate(agent.permissions, "shell", "rm -rf build")).toBe("deny");
    expect(evaluate(agent.permissions, "read", "/repo/.env")).toBe("ask");
  });

  it("places micode's allows before the agent's own rules and skips the ones the agent denies", () => {
    const agent = blankAgent("x");
    const allowed = ["edit", "bash", "webfetch", "external_directory"];
    toAgentInfo(agent, { permission: { edit: "deny", bash: { "git *": "allow" } } }, undefined, allowed);
    expect(added(agent)).toEqual([
      { action: "shell", resource: "*", effect: "allow" },
      { action: "webfetch", resource: "*", effect: "allow" },
      { action: "external_directory", resource: "*", effect: "allow" },
      { action: "edit", resource: "*", effect: "deny" },
      { action: "shell", resource: "git *", effect: "allow" },
    ]);
  });

  it("lets the user's global rules, which the host appends later, win over micode's", () => {
    const agent = blankAgent("x");
    toAgentInfo(agent, { permission: { edit: "deny" } }, undefined);
    const rules = withGlobals(agent, [{ action: "edit", resource: "*", effect: "allow" }]);
    expect(evaluate(rules, "edit", "/repo/src/a.ts")).toBe("allow");
  });

  it("denies edits only when both the edit and write tools are disabled", () => {
    const readOnly = blankAgent("x");
    toAgentInfo(readOnly, { tools: { write: false, edit: false } }, undefined);
    expect(added(readOnly)).toEqual([{ action: "edit", resource: "*", effect: "deny" }]);

    // ledger-creator: no edit tool, but it must still write ledgers (v2's write tool asserts "edit").
    const writer = blankAgent("y");
    toAgentInfo(writer, { tools: { edit: false }, permission: { edit: "allow" } }, undefined);
    expect(evaluate(writer.permissions, "edit", "/repo/thoughts/ledgers/CONTINUITY_x.md")).toBe("allow");
  });

  it("keeps the read-only micode agents from editing or running shell", () => {
    for (const name of ["codebase-locator", "codebase-analyzer", "pattern-finder", "mm-code-clusterer"]) {
      const agent = blankAgent(name);
      toAgentInfo(agent, agents[name], undefined);
      expect([name, evaluate(agent.permissions, "edit", "/repo/a.ts")]).toEqual([name, "deny"]);
      expect([name, evaluate(agent.permissions, "shell", "ls")]).toEqual([name, "deny"]);
    }
    const ledger = blankAgent("ledger-creator");
    toAgentInfo(ledger, agents["ledger-creator"], undefined);
    expect(evaluate(ledger.permissions, "edit", "/repo/thoughts/ledgers/CONTINUITY_x.md")).toBe("allow");
  });

  it("warns and ignores unreadable extra fields", () => {
    const logs = captureLogs();
    try {
      const agent = blankAgent("x");
      toAgentInfo(agent, { permission: { bash: 42 } } as any, undefined);
      expect(added(agent)).toEqual([]);
      expect(drain(logs.warn, /ignoring unreadable agent fields/)).toHaveLength(1);
      expect(logs.unread()).toEqual([]);
    } finally {
      logs.restore();
    }
  });

  it("translates the v1 bash and task tools into the v2 shell and subagent actions", () => {
    const agent = blankAgent("x");
    toAgentInfo(agent, { tools: { task: false, bash: false, spawn_agent: false } }, undefined);
    expect(added(agent)).toEqual([
      { action: "subagent", resource: "*", effect: "deny" },
      { action: "shell", resource: "*", effect: "deny" },
      { action: "spawn_agent", resource: "*", effect: "deny" },
    ]);
  });

  it("leaves host defaults alone for fields the config does not set", () => {
    const agent = blankAgent("x");
    toAgentInfo(agent, { description: "only this" }, undefined);
    expect(agent.description).toBe("only this");
    expect(agent.mode).toBe("primary");
    expect(agent.model).toBeUndefined();
    expect(agent.system).toBeUndefined();
    expect(agent.steps).toBeUndefined();
    expect(agent.request.body).toEqual({});
    expect(added(agent)).toEqual([]);
  });
});

describe("lastAssistantText", () => {
  it("joins the text parts of the last completed assistant turn", () => {
    const messages: any[] = [
      { type: "assistant", time: { created: 1, completed: 2 }, content: [{ type: "text", text: "done one" }] },
      { type: "assistant", time: { created: 3 }, content: [{ type: "text", text: "partial" }] },
    ];
    expect(lastAssistantText(messages)).toBe("done one");
  });

  it("throws when no completed reply exists or the turn errored", () => {
    expect(() => lastAssistantText([])).toThrow("no completed reply");
    const errored: any[] = [
      {
        type: "assistant",
        time: { created: 1, completed: 2 },
        error: { type: "x", message: "rate limited" },
        content: [],
      },
    ];
    expect(() => lastAssistantText(errored)).toThrow("rate limited");
  });
});

describe("createV2Host", () => {
  let logs: LogCapture;
  beforeEach(() => {
    logs = captureLogs();
  });
  afterEach(() => {
    logs.restore();
    expect(logs.unread()).toEqual([]);
  });

  it("runs an agent: create under the parent, prompt, wait and read the reply", async () => {
    const h = createHost();
    const host = createV2Host(h.host.session);
    const created: string[] = [];
    const reply = await host.runAgent({
      agent: "probe",
      text: "q",
      parentID: "ses_parent",
      title: "t",
      denyTools: true,
      model: MODEL,
      onCreated: (id) => created.push(id),
    });
    expect(reply).toEqual({ sessionID: "ses_child", text: "answer" });
    expect(created).toEqual(["ses_child"]);
    expect(h.sessions.created[0]).toEqual({
      title: "t",
      agent: "probe",
      parentID: "ses_parent",
      model: { providerID: "p", id: "m" },
      permissions: [...DENY_ALL_TOOLS],
    });
    expect(h.sessions.prompted[0]).toEqual({ sessionID: "ses_child", text: "q" });
    expect(h.sessions.waited).toEqual(["ses_child"]);
    expect(h.sessions.removed).toEqual([]);
  });

  it("omits model and permissions when the run does not ask for them", async () => {
    const h = createHost();
    const host = createV2Host(h.host.session);
    await host.runAgent({ agent: "a", text: "t" });
    expect(h.sessions.created[0]).toEqual({ agent: "a" });
  });

  it("rejects when the reply errored", async () => {
    const h = createHost();
    const session = {
      ...h.host.session,
      context: async () => [
        {
          type: "assistant",
          time: { created: 1, completed: 2 },
          error: { type: "x", message: "model down" },
          content: [],
        },
      ],
    } as unknown as V2Host["session"];
    await expect(createV2Host(session).runAgent({ agent: "a", text: "t" })).rejects.toThrow("model down");
  });

  it("prompts, interrupts, compacts, reads the last user text and removes through the session api", async () => {
    const h = createHost();
    const host = createV2Host(h.host.session);
    await host.prompt("s1", "continue", { model: MODEL, agent: "build" });
    await host.interrupt("s1");
    expect(await host.compact("s1", MODEL)).toBe("the summary");
    expect(await host.lastUserText("s1")).toBe("question");
    await host.remove("s1");
    expect(h.sessions.prompted[0]).toEqual({ sessionID: "s1", text: "continue" });
    expect(h.sessions.interrupted).toEqual(["s1"]);
    expect(h.sessions.compacted).toEqual(["s1"]);
    expect(h.sessions.waited).toEqual(["s1"]);
    expect(h.sessions.removed).toEqual(["s1"]);
  });

  it("rejects a failed compaction instead of returning an empty summary", async () => {
    const h = createHost();
    const session = {
      ...h.host.session,
      context: async () => [{ type: "compaction", status: "failed", error: { type: "x", message: "too long" } }],
    } as unknown as V2Host["session"];
    await expect(createV2Host(session).compact("s1", MODEL)).rejects.toThrow("too long");
  });

  it("joins multi-part replies with newlines like the v1 host", async () => {
    const h = createHost();
    const session = {
      ...h.host.session,
      context: async () => [
        {
          type: "assistant",
          time: { created: 1, completed: 2 },
          content: [
            { type: "text", text: "a" },
            { type: "text", text: "b" },
          ],
        },
      ],
    } as unknown as V2Host["session"];
    expect((await createV2Host(session).runAgent({ agent: "a", text: "t" })).text).toBe("a\nb");
  });

  it("returns an empty summary and no user text when the context has neither", async () => {
    const h = createHost();
    const session = { ...h.host.session, context: async () => [] } as unknown as V2Host["session"];
    const host = createV2Host(session);
    expect(await host.compact("s1", MODEL)).toBe("");
    expect(await host.lastUserText("s1")).toBeUndefined();
  });

  it("never throws from remove or notify", async () => {
    const h = createHost();
    const session = {
      ...h.host.session,
      remove: async () => {
        throw new Error("gone");
      },
    } as unknown as V2Host["session"];
    const host = createV2Host(session);
    await host.remove("s1");
    await host.notify(NOTE);
    expect(logs.warn).toEqual(["[host] failed to remove session s1: gone"]);
    expect(logs.info).toEqual(["[host] T: M"]);
  });
});
