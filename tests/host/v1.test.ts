import { describe, expect, it } from "bun:test";

import { createV1Host, joinTextParts, toV1Tool } from "../../src/host/v1";
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
