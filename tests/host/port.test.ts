import { describe, expect, it } from "bun:test";

import { DENY_ALL_TOOLS, type HostEvent, type SessionHost } from "../../src/host/port";

describe("host port", () => {
  it("exposes a deny-all permission ruleset for tool-less runs", () => {
    expect(DENY_ALL_TOOLS).toEqual([{ action: "*", resource: "*", effect: "deny" }]);
  });

  it("types normalized events as a discriminated union", () => {
    const deleted: HostEvent = { type: "session.deleted", sessionID: "ses_1" };
    const usage: HostEvent = { type: "assistant.usage", sessionID: "ses_1", input: 10, cacheRead: 5 };
    const failed: HostEvent = { type: "session.error", sessionID: "ses_1", error: "boom" };
    expect([deleted, usage, failed].map((e) => e.type)).toEqual([
      "session.deleted",
      "assistant.usage",
      "session.error",
    ]);
  });

  it("lets a fake host satisfy SessionHost", async () => {
    const host: SessionHost = {
      runAgent: async () => ({ sessionID: "ses_x", text: "ok" }),
      remove: async () => {},
      prompt: async () => {},
      interrupt: async () => {},
      compact: async () => "summary",
      lastUserText: async () => "hi",
      notify: async () => {},
    };
    expect((await host.runAgent({ agent: "probe", text: "q" })).text).toBe("ok");
  });
});
