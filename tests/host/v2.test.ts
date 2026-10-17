import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  createV2Host,
  DENY_ALL_TOOLS,
  lastAssistantText,
  normalizeEvent,
  setup,
  toAgentInfo,
  type V2Host,
} from "../../src/host/v2";
import { captureLogs, type LogCapture } from "../helpers/log-capture";

type Any = Record<string, any>;

const MODEL = { providerID: "p", modelID: "m" };
const NOTE = { title: "T", message: "M", variant: "info" as const, duration: 1 };

function blankAgent(id: string): Any {
  return {
    id,
    name: id,
    request: { settings: {}, headers: {}, body: {} },
    mode: "primary",
    hidden: false,
    permissions: [],
  };
}

function parseModel(ref: string): any {
  const [providerID, rest] = ref.split("/");
  const [id, variant] = rest.split("#");
  return variant ? { providerID, id, variant } : { providerID, id };
}

function createHost() {
  const tools = new Map<string, Any>();
  const agents = new Map<string, Any>();
  const commands = new Map<string, Any>();
  const mcp = new Map<string, Any>();
  const hooks = new Map<string, (input: Any) => Promise<void> | void>();
  let defaultAgent: string | undefined;
  let push: ((event: Any) => void) | undefined;
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
    location: { directory: "/tmp/micode-v2-test" },
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
      subscribe: ({ signal }: { signal: AbortSignal }) => ({
        async *[Symbol.asyncIterator]() {
          while (!signal.aborted) {
            const event = await new Promise<Any>((resolve) => {
              push = resolve;
              signal.addEventListener("abort", () => resolve(undefined), { once: true });
            });
            if (event === undefined) return;
            yield event;
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
    emit: (e: Any) => push?.(e),
  };
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
    expect(commander?.request.body.temperature).toBeDefined();
    expect(commander?.request.body.maxTokens).toBe(64000);
    expect(commander?.request.body.thinking).toMatchObject({ type: "enabled" });
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

  it("allows the micode actions when the host would ask", async () => {
    const h = createHost();
    cleanup = await setup(h.host);
    const evaluate = h.hooks.get("permission.evaluate")!;
    const ask = { action: "bash", resources: ["*"], effect: "ask", sessionID: "s1" };
    await evaluate(ask);
    expect(ask.effect).toBe("allow");
    const other = { action: "read", resources: ["x.env"], effect: "ask", sessionID: "s1" };
    await evaluate(other);
    expect(other.effect).toBe("ask");
    const denied = { action: "bash", resources: ["*"], effect: "deny", sessionID: "s1" };
    await evaluate(denied);
    expect(denied.effect).toBe("deny");
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
      input: { filePath: "/x/a.ts" },
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
    expect(agent.request.body).toEqual({ temperature: 0.3, maxTokens: 1000 });
    expect(agent.permissions).toEqual([
      { action: "edit", resource: "*", effect: "deny" },
      { action: "bash", resource: "*", effect: "allow" },
      { action: "write", resource: "*", effect: "deny" },
    ]);
  });

  it("expands per-command bash rules into resource patterns", () => {
    const agent = blankAgent("x");
    toAgentInfo(agent, { permission: { bash: { "git *": "allow", "rm *": "deny" } } } as any, undefined);
    expect(agent.permissions).toEqual([
      { action: "bash", resource: "git *", effect: "allow" },
      { action: "bash", resource: "rm *", effect: "deny" },
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
    expect(agent.permissions).toEqual([]);
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
