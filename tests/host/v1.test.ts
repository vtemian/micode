import { describe, expect, it } from "bun:test";

import { createV1Host, joinTextParts, server, toV1Tool } from "../../src/host/v1";
import { defineTool } from "../../src/tools/define";

type Log = Record<string, unknown[]>;

const MODEL = { providerID: "p", modelID: "m" };

function fakeClient(log: Log) {
  const record = (name: string, input: unknown) => {
    log[name] ??= [];
    log[name].push(input);
  };
  return {
    session: {
      create: async (i: unknown) => {
        record("create", i);
        return { data: { id: "ses_child" } };
      },
      prompt: async (i: unknown) => {
        record("prompt", i);
        return { data: { info: { role: "assistant" }, parts: [{ type: "text", text: "answer" }] } };
      },
      messages: async (i: unknown) => {
        record("messages", i);
        return {
          data: [
            { info: { role: "user" }, parts: [{ type: "text", text: "question" }] },
            { info: { role: "assistant" }, parts: [{ type: "text", text: "answer" }] },
            { info: { role: "assistant", summary: true }, parts: [{ type: "text", text: "the summary" }] },
          ],
        };
      },
      delete: async (i: unknown) => {
        record("delete", i);
        return {};
      },
      abort: async (i: unknown) => {
        record("abort", i);
        return { data: true };
      },
      summarize: async (i: unknown) => {
        record("summarize", i);
        return { data: true };
      },
    },
    tui: {
      showToast: async (i: unknown) => {
        record("toast", i);
        return {};
      },
    },
  };
}

describe("v1 host", () => {
  describe("runAgent", () => {
    it("creates under the parent, prompts with agent/model/tools and returns the blocking reply", async () => {
      const log: Log = {};
      const host = createV1Host(fakeClient(log) as any, "/work");
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
      expect(log.create[0]).toEqual({ body: { parentID: "ses_parent", title: "t" }, query: { directory: "/work" } });
      expect(log.prompt[0]).toMatchObject({
        path: { id: "ses_child" },
        body: { agent: "probe", tools: {}, model: MODEL, parts: [{ type: "text", text: "q" }] },
      });
      expect(log.messages).toBeUndefined();
    });

    it("throws when the host returns no session id", async () => {
      const client = fakeClient({});
      client.session.create = async () => ({ data: {} }) as never;
      const host = createV1Host(client as any, "/work");
      await expect(host.runAgent({ agent: "a", text: "t" })).rejects.toThrow("Failed to create session");
    });

    it("throws on an HTTP error response instead of returning an empty reply", async () => {
      const client = fakeClient({});
      client.session.prompt = async () => ({ error: { message: "agent not found" } }) as never;
      const host = createV1Host(client as any, "/work");
      await expect(host.runAgent({ agent: "nope", text: "t" })).rejects.toThrow("agent not found");
    });

    it("throws when the reply itself carries a provider error", async () => {
      const client = fakeClient({});
      client.session.prompt = async () =>
        ({ data: { info: { role: "assistant", error: { message: "rate limited" } }, parts: [] } }) as never;
      const host = createV1Host(client as any, "/work");
      await expect(host.runAgent({ agent: "a", text: "t" })).rejects.toThrow("rate limited");
    });
  });

  describe("compact", () => {
    it("summarizes and resolves with the summary once session.compacted arrives", async () => {
      const log: Log = {};
      const host = createV1Host(fakeClient(log) as any, "/work");

      const pending = host.compact("ses_1", MODEL);
      host.relay({ type: "session.compacted", properties: { sessionID: "ses_1" } });

      expect(await pending).toBe("the summary");
      expect(log.summarize[0]).toMatchObject({ path: { id: "ses_1" }, body: MODEL });
    });

    it("also settles on a completed summary message, but not on its creation", async () => {
      const host = createV1Host(fakeClient({}) as any, "/work");
      const pending = host.compact("ses_1", MODEL);
      let settled = false;
      void pending.then(() => {
        settled = true;
      });

      host.relay({
        type: "message.updated",
        properties: { info: { sessionID: "ses_1", role: "assistant", summary: true } },
      });
      await new Promise((r) => setTimeout(r, 0));
      expect(settled).toBe(false);

      host.relay({
        type: "message.updated",
        properties: { info: { sessionID: "ses_1", role: "assistant", summary: true, time: { completed: 1 } } },
      });
      expect(await pending).toBe("the summary");
    });

    it("rejects when the summary message carries an error and still emits the error event", async () => {
      const host = createV1Host(fakeClient({}) as any, "/work");
      const pending = host.compact("ses_1", MODEL);

      const emitted = host.relay({
        type: "message.updated",
        properties: { info: { sessionID: "ses_1", role: "assistant", summary: true, error: { message: "too long" } } },
      });

      await expect(pending).rejects.toThrow("too long");
      expect(emitted).toMatchObject({ type: "session.error", sessionID: "ses_1" });
    });

    it("rejects immediately when the summarize request fails", async () => {
      const client = fakeClient({});
      client.session.summarize = async () => ({ error: { message: "not found" } }) as never;
      const host = createV1Host(client as any, "/work");
      await expect(host.compact("ses_1", MODEL)).rejects.toThrow("not found");
    });

    it("rejects a pending compaction when the session is deleted", async () => {
      const host = createV1Host(fakeClient({}) as any, "/work");
      const pending = host.compact("ses_1", MODEL);
      host.relay({ type: "session.deleted", properties: { info: { id: "ses_1" } } });
      await expect(pending).rejects.toThrow("Session deleted");
    });
  });

  describe("relay", () => {
    it("normalizes v1 events", () => {
      const host = createV1Host(fakeClient({}) as any, "/work");
      expect(host.relay({ type: "session.deleted", properties: { info: { id: "s1" } } })).toEqual({
        type: "session.deleted",
        sessionID: "s1",
      });
      expect(
        host.relay({
          type: "message.updated",
          properties: {
            info: {
              sessionID: "s1",
              role: "assistant",
              tokens: { input: 10, cache: { read: 5 } },
              providerID: "p",
              modelID: "m",
            },
          },
        }),
      ).toEqual({ type: "assistant.usage", sessionID: "s1", input: 10, cacheRead: 5, model: MODEL });
      expect(host.relay({ type: "session.error", properties: { sessionID: "s1", error: "boom" } })).toEqual({
        type: "session.error",
        sessionID: "s1",
        error: "boom",
      });
      expect(
        host.relay({
          type: "message.updated",
          properties: { info: { sessionID: "s1", role: "assistant", error: "bad", providerID: "p", modelID: "m" } },
        }),
      ).toEqual({ type: "session.error", sessionID: "s1", error: "bad", model: MODEL });
    });

    it("drops user messages, summary usage, zero usage and unrelated events", () => {
      const host = createV1Host(fakeClient({}) as any, "/work");
      expect(
        host.relay({ type: "message.updated", properties: { info: { sessionID: "s1", role: "user" } } }),
      ).toBeUndefined();
      expect(
        host.relay({
          type: "message.updated",
          properties: { info: { sessionID: "s1", role: "assistant", summary: true, tokens: { input: 900 } } },
        }),
      ).toBeUndefined();
      expect(
        host.relay({
          type: "message.updated",
          properties: { info: { sessionID: "s1", role: "assistant", tokens: { input: 0 } } },
        }),
      ).toBeUndefined();
      expect(host.relay({ type: "session.idle", properties: {} })).toBeUndefined();
      expect(host.relay({ type: "session.deleted", properties: null })).toBeUndefined();
    });
  });

  describe("session calls", () => {
    it("prompts, interrupts, reads the last user text, removes and notifies through the client", async () => {
      const log: Log = {};
      const host = createV1Host(fakeClient(log) as any, "/work");

      await host.prompt("s1", "continue", { model: MODEL, agent: "build" });
      await host.interrupt("s1");
      await host.remove("s1");
      await host.notify({ title: "T", message: "M", variant: "info", duration: 1 });

      expect(log.prompt[0]).toMatchObject({
        path: { id: "s1" },
        body: { parts: [{ type: "text", text: "continue" }], model: MODEL, agent: "build" },
      });
      expect(log.abort[0]).toMatchObject({ path: { id: "s1" }, query: { directory: "/work" } });
      expect(log.delete[0]).toMatchObject({ path: { id: "s1" }, query: { directory: "/work" } });
      expect(log.toast[0]).toEqual({ body: { title: "T", message: "M", variant: "info", duration: 1 } });
      expect(await host.lastUserText("s1")).toBe("question");
    });

    it("surfaces HTTP errors from prompt and abort", async () => {
      const client = fakeClient({});
      client.session.prompt = async () => ({ error: "gone" }) as never;
      client.session.abort = async () => ({ error: "gone" }) as never;
      const host = createV1Host(client as any, "/work");
      await expect(host.prompt("s1", "x")).rejects.toThrow("Prompt failed");
      await expect(host.interrupt("s1")).rejects.toThrow("Abort failed");
    });

    it("returns undefined when the session has no user text", async () => {
      const client = fakeClient({});
      client.session.messages = async () => ({ data: [] });
      const host = createV1Host(client as any, "/work");
      expect(await host.lastUserText("s1")).toBeUndefined();
    });

    it("swallows delete and toast failures", async () => {
      const client = fakeClient({});
      client.session.delete = async () => {
        throw new Error("gone");
      };
      client.tui.showToast = async () => {
        throw new Error("no tui");
      };
      const host = createV1Host(client as any, "/work");
      await host.remove("s1");
      await host.notify({ title: "T", message: "M", variant: "info", duration: 1 });
    });
  });

  it("wraps a core tool for the v1 tool() helper and forwards the session id and progress", async () => {
    const core = defineTool({
      description: "d",
      args: {},
      execute: async (_a, call) => {
        call.progress?.("busy");
        return call.sessionID ?? "none";
      },
    });
    const titles: string[] = [];
    const wrapped = toV1Tool(core);
    const out = await wrapped.execute({}, {
      sessionID: "ses_host",
      metadata: (m: { title?: string }) => titles.push(m.title ?? ""),
    } as any);
    expect(out).toBe("ses_host");
    expect(titles).toEqual(["busy"]);
  });

  it("joins only text parts", () => {
    expect(joinTextParts([{ type: "text", text: "a" }, { type: "image" }, { type: "text", text: "b" }])).toBe("a\nb");
    expect(joinTextParts(undefined)).toBe("");
  });
});

describe("v1 server", () => {
  async function load(log: Log = {}) {
    const host = fakeClient(log);
    const hooks = await server({ client: host, directory: "/work" } as any);
    return { hooks, host };
  }

  it("exposes every micode tool through the v1 tool() helper", async () => {
    const { hooks } = await load();
    expect(Object.keys(hooks.tool ?? {})).toEqual(
      expect.arrayContaining(["spawn_agent", "batch_read", "ast_grep_search"]),
    );
    expect(hooks.tool?.spawn_agent.description).toBeString();
    await hooks.dispose?.();
  });

  describe("config", () => {
    it("allows the four permission actions without prompting", async () => {
      const { hooks } = await load();
      const cfg: any = { permission: { edit: "ask", doom_loop: "ask" } };
      await hooks.config?.(cfg);
      expect(cfg.permission).toEqual({
        edit: "allow",
        bash: "allow",
        webfetch: "allow",
        external_directory: "allow",
        doom_loop: "ask",
      });
      await hooks.dispose?.();
    });

    it("merges plugin agents over host agents and puts the primary agent last", async () => {
      const { hooks } = await load();
      const cfg: any = { agent: { build: { mode: "primary" } } };
      await hooks.config?.(cfg);
      expect(cfg.agent.build.mode).toBe("primary");
      expect(cfg.agent.executor).toBeDefined();
      expect(cfg.agent.commander.prompt).toBeString();
      expect(Object.keys(cfg.agent).at(-1)).toBe("commander");
      await hooks.dispose?.();
    });

    it("keeps user fields on a host-declared plugin agent", async () => {
      const { hooks } = await load();
      const cfg: any = { agent: { commander: { steps: 7 } } };
      await hooks.config?.(cfg);
      expect(cfg.agent.commander.steps).toBe(7);
      expect(cfg.agent.commander.prompt).toBeString();
      await hooks.dispose?.();
    });

    it("sets default_agent only when the user has not", async () => {
      const { hooks } = await load();
      const unset: any = {};
      await hooks.config?.(unset);
      expect(unset.default_agent).toBe("commander");
      const preset: any = { default_agent: "build" };
      await hooks.config?.(preset);
      expect(preset.default_agent).toBe("build");
      await hooks.dispose?.();
    });

    it("adds the four plugin commands with their agents", async () => {
      const { hooks } = await load();
      const cfg: any = { command: { mine: { template: "x" } } };
      await hooks.config?.(cfg);
      expect(Object.keys(cfg.command)).toEqual(["mine", "init", "mindmodel", "ledger", "search"]);
      expect(cfg.command.init).toEqual({
        description: expect.any(String),
        agent: "project-initializer",
        template: "Initialize this project. $ARGUMENTS",
      });
      expect(cfg.command.search.agent).toBe("artifact-searcher");
      await hooks.dispose?.();
    });

    it("adds mcp servers without overriding host entries", async () => {
      const { hooks } = await load();
      const mine = { type: "local", command: ["my-own-context7"] };
      const custom = { type: "local", command: ["custom"] };
      const cfg: any = { mcp: { context7: mine, custom } };
      await hooks.config?.(cfg);
      expect(cfg.mcp.context7).toEqual(mine);
      expect(cfg.mcp.custom).toEqual(custom);
      await hooks.dispose?.();
    });
  });

  it("adds the thinking option to chat.params after a think keyword in chat.message", async () => {
    const { hooks } = await load();
    await hooks["chat.message"]?.({ sessionID: "s1" }, {
      parts: [{ type: "text", text: "let's think about it" }],
    } as any);
    const thinking: any = { options: { keep: 1 } };
    await hooks["chat.params"]?.({ sessionID: "s1" } as any, thinking);
    expect(thinking.options).toMatchObject({ keep: 1, thinking: { type: "enabled" } });

    await hooks["chat.message"]?.({ sessionID: "s1" }, { parts: [{ type: "text", text: "go" }] } as any);
    const plain: any = { options: {} };
    await hooks["chat.params"]?.({ sessionID: "s1" } as any, plain);
    expect(plain.options).toEqual({});
    await hooks.dispose?.();
  });

  it("drops CLAUDE.md and AGENTS.md entries from the system prompt", async () => {
    const { hooks } = await load();
    const output = {
      system: ["base", "Instructions from: /x/CLAUDE.md\nrules", "Instructions from: /x/AGENTS.md\nrules", "other"],
    };
    await hooks["experimental.chat.system.transform"]?.({ sessionID: "s1" } as any, output);
    expect(output.system).toEqual(["base", "other"]);
    await hooks.dispose?.();
  });

  it("leaves the system prompt alone when the request carries no session id", async () => {
    const { hooks } = await load();
    const output = { system: ["Instructions from: /x/CLAUDE.md\nrules"] };
    await hooks["experimental.chat.system.transform"]?.({} as any, output);
    expect(output.system).toEqual(["Instructions from: /x/CLAUDE.md\nrules"]);
    await hooks.dispose?.();
  });

  it("replaces the compaction prompt with the structured summary instruction", async () => {
    const { hooks } = await load();
    const output: { context: string[]; prompt?: string } = { context: [] };
    await hooks["experimental.session.compacting"]?.({ sessionID: "s1" }, output);
    expect(output.prompt).toContain("# Session Summary");
    await hooks.dispose?.();
  });

  it("routes tool output through the core pipeline", async () => {
    const { hooks } = await load();
    const output: any = { title: "", output: "plain", metadata: {} };
    await hooks["tool.execute.after"]?.({ tool: "bash", sessionID: "s1", callID: "c", args: {} }, output);
    expect(output.output).toBe("plain");
    await hooks.dispose?.();
  });

  it("relays session.deleted so per-session state is forgotten", async () => {
    const { hooks } = await load();
    await hooks["chat.message"]?.({ sessionID: "s1" }, {
      parts: [{ type: "text", text: "think hard" }],
    } as any);
    await hooks.event?.({ event: { type: "session.deleted", properties: { info: { id: "s1" } } } as any });
    const params: any = { options: {} };
    await hooks["chat.params"]?.({ sessionID: "s1" } as any, params);
    expect(params.options).toEqual({});
    await hooks.dispose?.();
  });
});
