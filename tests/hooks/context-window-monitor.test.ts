import { describe, expect, it } from "bun:test";
import { createContextWindowMonitorHook } from "../../src/hooks/context-window-monitor";
import { createSessionUsage } from "../../src/hooks/session-usage";
import type { Notification } from "../../src/host/port";

const MODEL = { providerID: "p", modelID: "m" };

function setup(limit = 1000) {
  const sent: Notification[] = [];
  const usage = createSessionUsage(new Map([["p/m", limit]]));
  const hook = createContextWindowMonitorHook(usage, (notification) => {
    sent.push(notification);
    return Promise.resolve();
  });
  return { sent, usage, hook };
}

function usageEvent(sessionID: string, input: number) {
  return { type: "assistant.usage" as const, sessionID, input, cacheRead: 0, model: MODEL };
}

describe("context window monitor", () => {
  it("notifies once the warning threshold is crossed and throttles repeats", async () => {
    const { sent, usage, hook } = setup();
    const event = usageEvent("s1", 900);
    usage.onEvent(event);
    await hook.onEvent(event);
    await hook.onEvent(event);

    expect(sent).toHaveLength(1);
    expect(sent[0].title).toBe("Context Window");
    expect(sent[0].variant).toBe("warning");
    expect(sent[0].message).toContain("10% remaining");
  });

  it("uses the info variant between the warning and critical thresholds", async () => {
    const { sent, usage, hook } = setup();
    const event = usageEvent("s1", 750);
    usage.onEvent(event);
    await hook.onEvent(event);

    expect(sent).toHaveLength(1);
    expect(sent[0].variant).toBe("info");
  });

  it("stays quiet below the warning threshold", async () => {
    const { sent, usage, hook } = setup();
    const event = usageEvent("s1", 100);
    usage.onEvent(event);
    await hook.onEvent(event);

    expect(sent).toHaveLength(0);
    expect(hook.systemSuffix("s1")).toBe("");
  });

  it("appends a context-status block to a non-empty system prompt", async () => {
    const { usage, hook } = setup();
    const event = usageEvent("s1", 900);
    usage.onEvent(event);
    await hook.onEvent(event);

    expect(hook.systemSuffix("s1")).toContain("<context-status>");
    expect(hook.systemSuffix("s1")).toContain("wrapping up");
    expect(hook.systemSuffix("other")).toBe("");
  });

  it("encourages calm when usage is past warning but below critical", async () => {
    const { usage, hook } = setup();
    usage.onEvent(usageEvent("s1", 750));

    expect(hook.systemSuffix("s1")).toContain("Plenty of room");
  });

  it("ignores sessions with no usage and unrelated events", async () => {
    const { sent, hook } = setup();
    await hook.onEvent(usageEvent("ghost", 900));
    await hook.onEvent({ type: "session.error", sessionID: "s1", error: "x" });

    expect(sent).toHaveLength(0);
  });

  it("warns again after a session is deleted and reused", async () => {
    const { sent, usage, hook } = setup();
    const event = usageEvent("s1", 900);
    usage.onEvent(event);
    await hook.onEvent(event);
    await hook.onEvent({ type: "session.deleted", sessionID: "s1" });
    usage.onEvent(event);
    await hook.onEvent(event);

    expect(sent).toHaveLength(2);
  });
});
