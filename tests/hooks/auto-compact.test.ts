import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAutoCompactHook } from "../../src/hooks/auto-compact";
import { createSessionUsage } from "../../src/hooks/session-usage";
import type { Notification, SessionHost } from "../../src/host/port";

interface Calls {
  compacted: string[];
  prompted: string[];
  notified: Notification[];
}

const MODEL = { providerID: "p", modelID: "m" };
const LIMIT = 1000;

function fakeHost(calls: Calls, summary = "## Session Summary\nstuff"): SessionHost {
  return {
    runAgent: async () => ({ sessionID: "", text: "" }),
    remove: async () => {},
    prompt: async (sessionID, text) => {
      calls.prompted.push(`${sessionID}:${text.slice(0, 20)}`);
    },
    interrupt: async () => {},
    compact: async (sessionID) => {
      calls.compacted.push(sessionID);
      return summary;
    },
    lastUserText: async () => undefined,
    notify: async (notification) => {
      calls.notified.push(notification);
    },
  };
}

function newCalls(): Calls {
  return { compacted: [], prompted: [], notified: [] };
}

function usageEvent(sessionID: string, input: number) {
  return { type: "assistant.usage" as const, sessionID, input, cacheRead: 0, model: MODEL };
}

async function waitUntil(condition: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error("timeout waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("auto-compact", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "micode-autocompact-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("compacts above the threshold, writes the ledger and auto-continues", async () => {
    const calls = newCalls();
    const usage = createSessionUsage(new Map([["p/m", LIMIT]]));
    const hook = createAutoCompactHook({ directory: dir }, fakeHost(calls), usage, { compactionThreshold: 0.8 });
    const event = usageEvent("ses_abcdefgh123", 900);

    usage.onEvent(event);
    await hook.onEvent(event);
    await waitUntil(() => calls.prompted.length === 1);

    expect(calls.compacted).toEqual(["ses_abcdefgh123"]);
    expect(calls.prompted[0]).toBe("ses_abcdefgh123:Context was compacte");
    const ledger = await readFile(join(dir, "thoughts/ledgers/CONTINUITY_ses_abcd.md"), "utf-8");
    expect(ledger).toContain("session: ses_abcd");
    expect(ledger).toContain("## Session Summary");
    expect(calls.notified.map((n) => n.title)).toEqual(["Auto Compacting", "Compaction Complete"]);
    expect(calls.notified[0].message).toContain("90%");
    expect(calls.notified[0].message).toContain("threshold: 80%");
  });

  it("does not send a continue prompt when the host resumes the turn after compaction itself", async () => {
    const calls = newCalls();
    const usage = createSessionUsage(new Map([["p/m", LIMIT]]));
    const host: SessionHost = { ...fakeHost(calls), resumesAfterCompaction: true };
    const hook = createAutoCompactHook({ directory: dir }, host, usage, { compactionThreshold: 0.8 });
    const event = usageEvent("ses_resumes1", 900);

    usage.onEvent(event);
    await hook.onEvent(event);
    await waitUntil(() => calls.notified.length === 2);

    expect(calls.compacted).toEqual(["ses_resumes1"]);
    expect(calls.notified.map((n) => n.title)).toEqual(["Auto Compacting", "Compaction Complete"]);
    expect(calls.prompted).toEqual([]);
  });

  it("does nothing below the threshold", async () => {
    const calls = newCalls();
    const usage = createSessionUsage(new Map([["p/m", LIMIT]]));
    const hook = createAutoCompactHook({ directory: dir }, fakeHost(calls), usage);
    const event = usageEvent("s1", 100);

    usage.onEvent(event);
    await hook.onEvent(event);

    expect(calls.compacted).toEqual([]);
    expect(calls.notified).toEqual([]);
  });

  it("skips sessions whose model is unknown", async () => {
    const calls = newCalls();
    const usage = createSessionUsage(new Map([["p/m", LIMIT]]));
    const hook = createAutoCompactHook({ directory: dir }, fakeHost(calls), usage, { compactionThreshold: 0.5 });
    const event = { type: "assistant.usage" as const, sessionID: "s1", input: 190_000, cacheRead: 0 };

    usage.onEvent(event);
    await hook.onEvent(event);

    expect(calls.compacted).toEqual([]);
  });

  it("ignores unrelated events", async () => {
    const calls = newCalls();
    const hook = createAutoCompactHook({ directory: dir }, fakeHost(calls), createSessionUsage());

    await hook.onEvent({ type: "session.error", sessionID: "s1", error: "boom" });
    await hook.onEvent({ type: "session.deleted", sessionID: "s1" });

    expect(calls.compacted).toEqual([]);
  });

  it("does not start a second compaction while one is in progress", async () => {
    const calls = newCalls();
    let release: () => void = () => {};
    const host: SessionHost = {
      ...fakeHost(calls),
      compact: async (sessionID) => {
        calls.compacted.push(sessionID);
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return "summary";
      },
    };
    const usage = createSessionUsage(new Map([["p/m", LIMIT]]));
    const hook = createAutoCompactHook({ directory: dir }, host, usage, { compactionThreshold: 0.5 });
    const event = usageEvent("s1", 900);

    usage.onEvent(event);
    await hook.onEvent(event);
    await waitUntil(() => calls.compacted.length === 1);
    await hook.onEvent(event);

    expect(calls.compacted).toEqual(["s1"]);
    release();
    await waitUntil(() => calls.prompted.length === 1);
  });

  it("respects the cooldown after a successful compaction", async () => {
    const calls = newCalls();
    const usage = createSessionUsage(new Map([["p/m", LIMIT]]));
    const hook = createAutoCompactHook({ directory: dir }, fakeHost(calls), usage, { compactionThreshold: 0.5 });
    const event = usageEvent("s1", 900);

    usage.onEvent(event);
    await hook.onEvent(event);
    await waitUntil(() => calls.prompted.length === 1);
    await hook.onEvent(event);

    expect(calls.compacted).toEqual(["s1"]);
  });

  it("skips the ledger when the summary is empty", async () => {
    const calls = newCalls();
    const usage = createSessionUsage(new Map([["p/m", LIMIT]]));
    const hook = createAutoCompactHook({ directory: dir }, fakeHost(calls, "   "), usage, { compactionThreshold: 0.5 });
    const event = usageEvent("ses_empty_summary", 900);

    usage.onEvent(event);
    await hook.onEvent(event);
    await waitUntil(() => calls.prompted.length === 1);

    await expect(readFile(join(dir, "thoughts/ledgers/CONTINUITY_ses_empt.md"), "utf-8")).rejects.toThrow();
  });

  it("reports a failed auto-continue as a warning, not a failed compaction", async () => {
    const calls = newCalls();
    const host: SessionHost = {
      ...fakeHost(calls),
      prompt: async () => {
        throw new Error("session busy");
      },
    };
    const usage = createSessionUsage(new Map([["p/m", LIMIT]]));
    const hook = createAutoCompactHook({ directory: dir }, host, usage, { compactionThreshold: 0.5 });
    const event = usageEvent("ses_contfail", 900);

    usage.onEvent(event);
    await hook.onEvent(event);
    await waitUntil(() => calls.notified.length === 3);

    expect(calls.notified.map((n) => n.title)).toEqual(["Auto Compacting", "Compaction Complete", "Continue Failed"]);
    expect(calls.notified[2].message).toContain("session busy");
    await expect(readFile(join(dir, "thoughts/ledgers/CONTINUITY_ses_cont.md"), "utf-8")).resolves.toContain("stuff");
  });

  it("does not leak an unhandled rejection when notify throws, and releases the in-progress flag", async () => {
    const calls = newCalls();
    let notifications = 0;
    const host: SessionHost = {
      ...fakeHost(calls),
      notify: async () => {
        notifications += 1;
        throw new Error("no tui");
      },
    };
    const usage = createSessionUsage(new Map([["p/m", LIMIT]]));
    const hook = createAutoCompactHook({ directory: dir }, host, usage, { compactionThreshold: 0.5 });
    const event = usageEvent("ses_notify", 900);
    const logged = spyOn(console, "error").mockImplementation(() => {});
    let errors: number | undefined;

    try {
      usage.onEvent(event);
      await hook.onEvent(event);
      // The start notification throws, the failure notification throws too: two attempts per flow.
      await waitUntil(() => notifications === 2);
      expect(calls.compacted).toEqual([]);

      await hook.onEvent(event);
      await waitUntil(() => notifications === 4 && logged.mock.calls.length === 2);
      errors = logged.mock.calls.length;
    } finally {
      logged.mockRestore();
    }
    expect(errors).toBe(2);
  });

  it("notifies on failure and releases the in-progress flag", async () => {
    const calls = newCalls();
    let attempts = 0;
    const host: SessionHost = {
      ...fakeHost(calls),
      compact: async () => {
        attempts += 1;
        throw new Error("Compaction timed out");
      },
    };
    const usage = createSessionUsage(new Map([["p/m", LIMIT]]));
    const hook = createAutoCompactHook({ directory: dir }, host, usage, { compactionThreshold: 0.5 });
    const event = usageEvent("s1", 900);

    usage.onEvent(event);
    await hook.onEvent(event);
    await waitUntil(() => calls.notified.length === 2);

    expect(calls.notified[1].title).toBe("Compaction Failed");
    expect(calls.notified[1].message).toContain("Compaction timed out");
    expect(calls.prompted).toEqual([]);

    await hook.onEvent(event);
    await waitUntil(() => calls.notified.length === 4);
    expect(attempts).toBe(2);
  });
});
