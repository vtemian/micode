import { describe, expect, it } from "bun:test";

import { createV1Host, joinTextParts, toV1Tool } from "../../src/host/v1";
import { defineTool } from "../../src/tools/define";

type Log = Record<string, unknown[]>;

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
        return { data: { parts: [{ type: "text", text: "ignored" }] } };
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
        return {};
      },
      summarize: async (i: unknown) => {
        record("summarize", i);
        return {};
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
  it("runs an agent: create with parentID, blocking prompt, then reads the last assistant text", async () => {
    const log: Log = {};
    const host = createV1Host(fakeClient(log) as any, "/work");
    const created: string[] = [];

    const reply = await host.runAgent({
      agent: "probe",
      text: "q",
      parentID: "ses_parent",
      title: "t",
      denyTools: true,
      model: { providerID: "p", modelID: "m" },
      onCreated: (id) => created.push(id),
    });

    expect(reply).toEqual({ sessionID: "ses_child", text: "the summary" });
    expect(created).toEqual(["ses_child"]);
    expect(log.create[0]).toEqual({ body: { parentID: "ses_parent", title: "t" }, query: { directory: "/work" } });
    expect(log.prompt[0]).toMatchObject({
      path: { id: "ses_child" },
      body: {
        agent: "probe",
        tools: {},
        model: { providerID: "p", modelID: "m" },
        parts: [{ type: "text", text: "q" }],
      },
    });
  });

  it("throws when the host returns no session id", async () => {
    const client = fakeClient({});
    client.session.create = async () => ({ data: {} }) as never;
    const host = createV1Host(client as any, "/work");
    await expect(host.runAgent({ agent: "a", text: "t" })).rejects.toThrow("Failed to create session");
  });

  it("compacts by summarizing and waiting for the summary message event", async () => {
    const log: Log = {};
    const host = createV1Host(fakeClient(log) as any, "/work");

    const pending = host.compact("ses_1", { providerID: "p", modelID: "m" });
    host.relay({
      type: "message.updated",
      properties: { info: { sessionID: "ses_1", role: "assistant", summary: true } },
    });

    expect(await pending).toBe("the summary");
    expect(log.summarize[0]).toMatchObject({ path: { id: "ses_1" }, body: { providerID: "p", modelID: "m" } });
  });

  it("rejects a pending compaction when the session is deleted", async () => {
    const host = createV1Host(fakeClient({}) as any, "/work");
    const pending = host.compact("ses_1", { providerID: "p", modelID: "m" });
    host.relay({ type: "session.deleted", properties: { info: { id: "ses_1" } } });
    await expect(pending).rejects.toThrow("Session deleted");
  });

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
    ).toEqual({
      type: "assistant.usage",
      sessionID: "s1",
      input: 10,
      cacheRead: 5,
      model: { providerID: "p", modelID: "m" },
    });
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
    ).toEqual({ type: "session.error", sessionID: "s1", error: "bad", model: { providerID: "p", modelID: "m" } });
    expect(
      host.relay({ type: "message.updated", properties: { info: { sessionID: "s1", role: "user" } } }),
    ).toBeUndefined();
    expect(host.relay({ type: "session.idle", properties: {} })).toBeUndefined();
  });

  it("prompts, interrupts, reads the last user text, removes and notifies through the client", async () => {
    const log: Log = {};
    const host = createV1Host(fakeClient(log) as any, "/work");

    await host.prompt("s1", "continue", { model: { providerID: "p", modelID: "m" }, agent: "build" });
    await host.interrupt("s1");
    await host.remove("s1");
    await host.notify({ title: "T", message: "M", variant: "info", duration: 1 });

    expect(log.prompt[0]).toMatchObject({
      path: { id: "s1" },
      body: { parts: [{ type: "text", text: "continue" }], model: { providerID: "p", modelID: "m" }, agent: "build" },
    });
    expect(log.abort[0]).toMatchObject({ path: { id: "s1" } });
    expect(log.delete[0]).toMatchObject({ path: { id: "s1" } });
    expect(log.toast[0]).toEqual({ body: { title: "T", message: "M", variant: "info", duration: 1 } });
    expect(await host.lastUserText("s1")).toBe("question");
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
