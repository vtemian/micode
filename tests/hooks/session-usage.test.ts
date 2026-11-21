import { describe, expect, it } from "bun:test";

import { createSessionUsage } from "../../src/hooks/session-usage";

describe("session usage", () => {
  it("records usage from assistant.usage events and resolves the model's limit", () => {
    const usage = createSessionUsage(new Map([["anthropic/claude-x", 400_000]]));

    usage.onEvent({
      type: "assistant.usage",
      sessionID: "s1",
      input: 100_000,
      cacheRead: 100_000,
      model: { providerID: "anthropic", modelID: "claude-x" },
    });

    expect(usage.get("s1")).toEqual({
      used: 200_000,
      limit: 400_000,
      ratio: 0.5,
      model: { providerID: "anthropic", modelID: "claude-x" },
    });
  });

  it("counts cache writes toward the context in use", () => {
    const usage = createSessionUsage();
    usage.onEvent({ type: "assistant.usage", sessionID: "s1", input: 10, cacheRead: 5, cacheWrite: 85 });
    expect(usage.get("s1")?.used).toBe(100);
  });

  it("forgets a session's usage on reset until the next usage event", () => {
    const usage = createSessionUsage();
    usage.onEvent({ type: "assistant.usage", sessionID: "s1", input: 10, cacheRead: 5 });
    usage.reset("s1");
    expect(usage.get("s1")).toBeUndefined();
    usage.onEvent({ type: "assistant.usage", sessionID: "s1", input: 3, cacheRead: 0 });
    expect(usage.get("s1")?.used).toBe(3);
  });

  it("ignores zero-token events and unknown sessions", () => {
    const usage = createSessionUsage();
    usage.onEvent({ type: "assistant.usage", sessionID: "s1", input: 0, cacheRead: 0 });
    expect(usage.get("s1")).toBeUndefined();
    expect(usage.get("never-seen")).toBeUndefined();
  });

  it("falls back to the default limit when the event carries no model", () => {
    const usage = createSessionUsage();
    usage.onEvent({ type: "assistant.usage", sessionID: "s1", input: 10, cacheRead: 5 });
    const current = usage.get("s1");
    expect(current?.used).toBe(15);
    expect(current?.limit).toBeGreaterThan(0);
    expect(current?.model).toBeUndefined();
  });

  it("ignores unrelated events", () => {
    const usage = createSessionUsage();
    usage.onEvent({ type: "session.error", sessionID: "s1", error: "boom" });
    expect(usage.get("s1")).toBeUndefined();
  });

  it("forgets a deleted session", () => {
    const usage = createSessionUsage();
    usage.onEvent({ type: "assistant.usage", sessionID: "s1", input: 10, cacheRead: 0 });
    usage.onEvent({ type: "session.deleted", sessionID: "s1" });
    expect(usage.get("s1")).toBeUndefined();
  });
});
