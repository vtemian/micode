import { describe, expect, it, spyOn } from "bun:test";
import { createSessionRecoveryHook } from "../../src/hooks/session-recovery";
import type { Notification, PromptHint, SessionHost } from "../../src/host/port";

interface Calls {
  interrupted: string[];
  prompted: { sessionID: string; text: string; hint?: PromptHint }[];
  notified: Notification[];
}

function newCalls(): Calls {
  return { interrupted: [], prompted: [], notified: [] };
}

function fakeHost(calls: Calls, { lastUser }: { lastUser?: string } = { lastUser: "do the thing" }): SessionHost {
  return {
    runAgent: async () => ({ sessionID: "", text: "" }),
    remove: async () => {},
    prompt: async (sessionID, text, hint) => {
      calls.prompted.push({ sessionID, text, hint });
    },
    interrupt: async (sessionID) => {
      calls.interrupted.push(sessionID);
    },
    compact: async () => "",
    lastUserText: async () => lastUser,
    notify: async (notification) => {
      calls.notified.push(notification);
    },
  };
}

const FAST = { settleMs: 0, dedupExpiryMs: 20 };

function errorEvent(sessionID: string, error: unknown) {
  return { type: "session.error" as const, sessionID, error };
}

describe("session recovery", () => {
  it("interrupts and resumes on a recoverable provider error", async () => {
    const calls = newCalls();
    const hook = createSessionRecoveryHook(fakeHost(calls), FAST);

    await hook.onEvent({
      type: "session.error",
      sessionID: "s1",
      error: "messages.3: tool_result block(s) missing",
      model: { providerID: "p", modelID: "m" },
      agent: "build",
    });

    expect(calls.interrupted).toEqual(["s1"]);
    expect(calls.prompted).toHaveLength(1);
    expect(calls.prompted[0]).toMatchObject({
      sessionID: "s1",
      text: "Continue from where you left off.",
      hint: { model: { providerID: "p", modelID: "m" }, agent: "build" },
    });
    expect(calls.notified.map((n) => n.title)).toEqual(["Session Recovery", "Recovery Complete"]);
    expect(calls.notified[0].message).toContain("tool result missing");
  });

  it("recovers from each known provider error pattern", async () => {
    const patterns = [
      "thinking blocks must be at the start of the message",
      "Thinking is not enabled for this model",
      "messages.2: content cannot be empty",
      "tool_result must follow tool_use",
    ];
    const calls = newCalls();
    const hook = createSessionRecoveryHook(fakeHost(calls), FAST);

    for (const [index, error] of patterns.entries()) {
      await hook.onEvent(errorEvent(`s${index}`, error));
    }

    expect(calls.interrupted).toEqual(["s0", "s1", "s2", "s3"]);
  });

  it("ignores unrelated errors and sessions without a user prompt", async () => {
    const calls = newCalls();
    const hook = createSessionRecoveryHook(fakeHost(calls, { lastUser: undefined }), FAST);

    await hook.onEvent(errorEvent("s1", "rate limited"));
    await hook.onEvent(errorEvent("s2", "content cannot be empty"));

    expect(calls.interrupted).toEqual(["s2"]);
    expect(calls.prompted).toEqual([]);
    expect(calls.notified.map((n) => n.title)).toEqual(["Session Recovery", "Recovery Incomplete"]);
  });

  it("ignores empty errors and unrelated events", async () => {
    const calls = newCalls();
    const hook = createSessionRecoveryHook(fakeHost(calls), FAST);

    await hook.onEvent(errorEvent("s1", undefined));
    await hook.onEvent(errorEvent("s1", ""));
    await hook.onEvent({ type: "assistant.usage", sessionID: "s1", input: 10, cacheRead: 0 });

    expect(calls.interrupted).toEqual([]);
    expect(calls.notified).toEqual([]);
  });

  it("classifies Error instances and plain objects", async () => {
    const calls = newCalls();
    const hook = createSessionRecoveryHook(fakeHost(calls), FAST);

    await hook.onEvent(errorEvent("s1", new Error("thinking is not enabled")));
    await hook.onEvent(errorEvent("s2", { data: { message: "tool_result block(s) missing" } }));

    expect(calls.interrupted).toEqual(["s1", "s2"]);
  });

  it("deduplicates rapid identical errors for the same session", async () => {
    const calls = newCalls();
    const hook = createSessionRecoveryHook(fakeHost(calls), FAST);
    const error = "tool_result block(s) missing";

    await Promise.all([hook.onEvent(errorEvent("s1", error)), hook.onEvent(errorEvent("s1", error))]);
    await hook.onEvent(errorEvent("s1", error));

    expect(calls.interrupted).toEqual(["s1"]);
  });

  it("keeps recovering when the interrupt fails", async () => {
    const calls = newCalls();
    const host: SessionHost = {
      ...fakeHost(calls),
      interrupt: async () => {
        throw new Error("abort failed");
      },
    };
    const hook = createSessionRecoveryHook(host, FAST);

    await hook.onEvent(errorEvent("s1", "content cannot be empty"));

    expect(calls.prompted).toHaveLength(1);
    expect(calls.notified.map((n) => n.title)).toEqual(["Session Recovery", "Recovery Complete"]);
  });

  it("does not fail when the resume prompt throws", async () => {
    const calls = newCalls();
    const host: SessionHost = {
      ...fakeHost(calls),
      prompt: async () => {
        throw new Error("prompt failed");
      },
    };
    const hook = createSessionRecoveryHook(host, FAST);
    const warn = spyOn(console, "warn").mockImplementation(() => {});

    let warnings: number | undefined;
    try {
      await hook.onEvent(errorEvent("s1", "content cannot be empty"));
      warnings = warn.mock.calls.length;
    } finally {
      warn.mockRestore();
    }

    expect(warnings).toBe(1);
    expect(calls.interrupted).toEqual(["s1"]);
    expect(calls.notified.map((n) => n.title)).toEqual(["Session Recovery", "Recovery Incomplete"]);
  });

  it("gives up on the same error after the max attempts", async () => {
    const calls = newCalls();
    const hook = createSessionRecoveryHook(fakeHost(calls), FAST);
    const error = "thinking is not enabled";

    for (let i = 0; i < 4; i++) {
      await hook.onEvent(errorEvent("s1", error));
      // let the dedup key expire so the next event is not treated as a duplicate
      await new Promise((r) => setTimeout(r, FAST.dedupExpiryMs + 5));
    }

    expect(calls.interrupted).toEqual(["s1", "s1", "s1"]);
    expect(calls.notified.at(-1)?.title).toBe("Recovery Failed");
  });

  it("survives a notify that throws", async () => {
    const calls = newCalls();
    const host: SessionHost = {
      ...fakeHost(calls),
      notify: async () => {
        throw new Error("no tui");
      },
    };
    const hook = createSessionRecoveryHook(host, FAST);
    await expect(hook.onEvent(errorEvent("s1", "content cannot be empty"))).rejects.toThrow("no tui");
  });

  it("forgets a deleted session so it can recover again", async () => {
    const calls = newCalls();
    const hook = createSessionRecoveryHook(fakeHost(calls), FAST);
    const error = "tool_result block(s) missing";

    await hook.onEvent(errorEvent("s1", error));
    await hook.onEvent({ type: "session.deleted", sessionID: "s1" });
    await hook.onEvent(errorEvent("s1", error));

    expect(calls.interrupted).toEqual(["s1", "s1"]);
  });
});
