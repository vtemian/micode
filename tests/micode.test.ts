import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AgentRun, SessionHost } from "../src/host/port";
import { createMicode, type Micode, trackInternalSessions } from "../src/micode";
import { captureLogs, type LogCapture } from "./helpers/log-capture";

function fakeHost(runs: AgentRun[] = []): SessionHost {
  return {
    runAgent: async (run) => {
      runs.push(run);
      run.onCreated?.("ses_internal");
      return { sessionID: "ses_internal", text: '{"status":"PASS","violations":[],"summary":"ok"}' };
    },
    remove: async () => {},
    prompt: async () => {},
    interrupt: async () => {},
    compact: async () => "",
    lastUserText: async () => undefined,
    notify: async () => {},
  };
}

describe("createMicode", () => {
  let dir: string;
  let micode: Micode;
  let logs: LogCapture;

  beforeEach(async () => {
    logs = captureLogs();
    dir = await mkdtemp(join(tmpdir(), "micode-core-"));
    micode = await createMicode({ directory: dir, host: fakeHost() });
  });

  afterEach(async () => {
    await micode.dispose();
    await rm(dir, { recursive: true, force: true });
    // Startup probes for ast-grep/btca/bun-pty log their findings; nothing else may.
    const unexpected = [...logs.warn, ...logs.info].filter((l) => !/ast-grep|btca|pty\.loader|BUN_PTY/i.test(l));
    logs.restore();
    expect(unexpected).toEqual([]);
    expect(logs.unread()).toEqual([]);
  });

  it("registers the plugin tools, agents, commands and mcp servers", () => {
    expect(Object.keys(micode.tools)).toEqual(
      expect.arrayContaining(["ast_grep_search", "spawn_agent", "batch_read", "mindmodel_lookup", "start_session"]),
    );
    expect(Object.keys(micode.agents)).toEqual(
      expect.arrayContaining(["commander", "executor", "mm-constraint-reviewer"]),
    );
    expect(micode.defaultAgent).toBe("commander");
    expect(micode.commands.map((c) => c.name)).toEqual(["init", "mindmodel", "ledger", "search"]);
    expect(micode.commands.find((c) => c.name === "init")?.agent).toBe("project-initializer");
    expect(micode.commands.find((c) => c.name === "mindmodel")?.agent).toBe("mm-orchestrator");
    expect(micode.allowedActions).toEqual(["edit", "bash", "webfetch", "external_directory"]);
    expect(typeof micode.mcpServers).toBe("object");
  });

  it("drops CLAUDE.md and AGENTS.md instructions from the system prompt", async () => {
    const system = await micode.systemPrompt({
      sessionID: "s1",
      system: [
        "base",
        "Instructions from: /x/CLAUDE.md\nrules",
        "Instructions from: /x/AGENTS.md\nrules",
        "Instructions from: /x/OTHER.md\nkeep",
      ],
    });
    expect(system).toEqual(["base", "Instructions from: /x/OTHER.md\nkeep"]);
  });

  it("drops only the CLAUDE.md and AGENTS.md blocks from an entry that joins several instruction files", async () => {
    // OpenCode joins loaded instruction files into one entry, each block headed "Instructions from: <path>".
    const system = await micode.systemPrompt({
      sessionID: "s1",
      system: [
        "Instructions from: /x/CLAUDE.md\nrules\nInstructions from: /x/OTHER.md\nkeep",
        "Instructions from: /x/OTHER.md\nkeep\nInstructions from: /x/AGENTS.md\nrules",
        "<env>\n  Working directory: /x\n</env>\nInstructions from: /x/AGENTS.md\nrules",
      ],
    });
    expect(system).toEqual([
      "Instructions from: /x/OTHER.md\nkeep",
      "Instructions from: /x/OTHER.md\nkeep",
      "<env>\n  Working directory: /x\n</env>",
    ]);
  });

  it("never drops unrelated blocks that merely mention CLAUDE.md", async () => {
    const entries = [
      "Read CLAUDE.md before editing.",
      "Instructions from: /x/MY_CLAUDE.md\nkeep",
      "Instructions from: /x/CLAUDE.md.bak\nkeep",
      "Instructions from: /x/CLAUDE.md-notes/README.md\nkeep",
    ];
    expect(await micode.systemPrompt({ sessionID: "s1", system: entries })).toEqual(entries);
  });

  it("enables extended thinking for the request after a think keyword", async () => {
    await micode.onPrompt({ sessionID: "s1", text: "let's think about it" });
    expect(micode.requestOptions("s1")).toMatchObject({ thinking: { type: "enabled" } });
    await micode.onPrompt({ sessionID: "s1", text: "just do it" });
    expect(micode.requestOptions("s1")).toEqual({});
  });

  it("returns no request options for an unknown session", () => {
    expect(micode.requestOptions("never-seen")).toEqual({});
  });

  it("builds the structured compaction instruction with tracked file operations", async () => {
    await micode.onToolResult({ tool: "read", sessionID: "s1", args: { filePath: "/x/a.ts" }, output: "contents" });
    const instruction = micode.compactionInstruction("s1");
    expect(instruction).toContain("# Session Summary");
    expect(instruction).toContain("- `/x/a.ts`");
    expect(instruction).toContain("### Modified\n- (none)");
  });

  it("passes tool output through unchanged when no hook touches it", async () => {
    const out = await micode.onToolResult({ tool: "bash", sessionID: "s1", args: {}, output: "plain" });
    expect(out).toBe("plain");
  });

  it("records the agent for a session so fragments can target it", async () => {
    micode.onRequest({ sessionID: "s1", agent: "executor", model: { providerID: "p", modelID: "m" } });
    const system = await micode.systemPrompt({ sessionID: "s1", system: ["base"] });
    expect(system).toContain("base");
  });

  it("forgets per-session state when the session is deleted", async () => {
    await micode.onPrompt({ sessionID: "s1", text: "think hard", model: { providerID: "p", modelID: "m" } });
    expect(micode.requestOptions("s1")).toMatchObject({ thinking: { type: "enabled" } });
    await micode.onEvent({ type: "session.deleted", sessionID: "s1" });
    expect(micode.requestOptions("s1")).toEqual({});
  });

  it("ignores usage and error events for sessions it has never seen", async () => {
    await micode.onEvent({ type: "assistant.usage", sessionID: "s9", input: 10, cacheRead: 0 });
    await micode.onEvent({ type: "session.error", sessionID: "s9", error: "boom" });
    expect(micode.requestOptions("s9")).toEqual({});
  });

  it("appends the context-window status last so the cached system prefix stays stable", async () => {
    // Unknown model falls back to the 200k default limit; 190k used is past the warning threshold.
    await micode.onEvent({ type: "assistant.usage", sessionID: "s1", input: 190_000, cacheRead: 0 });
    const system = await micode.systemPrompt({ sessionID: "s1", system: ["base"] });
    expect(system[0]).toBe("base");
    expect(system.at(-1)).toContain("<context-status>");
  });

  it("keeps routing an event to the other listeners when one of them fails", async () => {
    const throwing = {
      ...fakeHost(),
      notify: async () => {
        throw new Error("no tui");
      },
    };
    const core = await createMicode({ directory: dir, host: throwing });
    try {
      // Recovery rejects when notify throws; the router must swallow that and log it.
      await core.onEvent({ type: "session.error", sessionID: "s1", error: "content cannot be empty" });
      expect(logs.error.some((l) => l.includes("session recovery listener failed"))).toBe(true);
    } finally {
      await core.dispose();
    }
  });
});

describe("system prompt scoping", () => {
  const LEDGER_MARK = "LEDGER-MARK";
  const ARCH_MARK = "ARCH-MARK";
  const MODEL = { providerID: "p", modelID: "m" };
  let dir: string;
  let logs: LogCapture;

  async function waitUntil(condition: () => Promise<boolean>): Promise<void> {
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      if (await condition()) return;
      await new Promise((r) => setTimeout(r, 5));
    }
    throw new Error("condition not met");
  }

  async function prompt(core: Micode, sessionID: string): Promise<string> {
    return (await core.systemPrompt({ sessionID, system: ["base"] })).join("\n");
  }

  beforeEach(async () => {
    logs = captureLogs();
    dir = await mkdtemp(join(tmpdir(), "micode-scoping-"));
    await mkdir(join(dir, "thoughts", "ledgers"), { recursive: true });
    await writeFile(join(dir, "thoughts", "ledgers", "CONTINUITY_abc.md"), `# Ledger\n${LEDGER_MARK}\n`);
    await writeFile(join(dir, "ARCHITECTURE.md"), `# Architecture\n${ARCH_MARK}\n`);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    const unexpected = [...logs.warn, ...logs.info].filter((l) => !/ast-grep|btca|pty\.loader|BUN_PTY/i.test(l));
    logs.restore();
    expect(unexpected).toEqual([]);
    expect(logs.unread()).toEqual([]);
  });

  it("gives a fresh session the project context but not the continuity ledger", async () => {
    const core = await createMicode({ directory: dir, host: fakeHost() });
    try {
      await core.onPrompt({ sessionID: "s1", text: "add a feature" });
      const system = await prompt(core, "s1");
      expect(system).toContain(ARCH_MARK);
      expect(system).not.toContain(LEDGER_MARK);
    } finally {
      await core.dispose();
    }
  });

  it("injects the ledger once the host compacts the session with micode's instruction", async () => {
    const core = await createMicode({ directory: dir, host: fakeHost() });
    try {
      core.compactionInstruction("s1");
      expect(await prompt(core, "s1")).toContain(LEDGER_MARK);
      expect(await prompt(core, "s2")).not.toContain(LEDGER_MARK);
    } finally {
      await core.dispose();
    }
  });

  it("injects the session's own ledger after auto-compact compacts it", async () => {
    const compacted: string[] = [];
    const host = {
      ...fakeHost(),
      compact: async (sessionID: string) => {
        compacted.push(sessionID);
        return "summary";
      },
    };
    const core = await createMicode({ directory: dir, host });
    try {
      await core.onEvent({ type: "assistant.usage", sessionID: "s1", input: 190_000, cacheRead: 0, model: MODEL });
      await waitUntil(async () => (await prompt(core, "s1")).includes('<continuity-ledger session="s1">'));
      expect(compacted).toEqual(["s1"]);
    } finally {
      await core.dispose();
    }
  });

  it("injects the ledger for a session whose first prompt is a /ledger resume", async () => {
    const core = await createMicode({ directory: dir, host: fakeHost() });
    try {
      await core.onPrompt({ sessionID: "s1", text: "/ledger pick up the auth work" });
      expect(await prompt(core, "s1")).toContain(LEDGER_MARK);
      await core.onPrompt({ sessionID: "s2", text: "Update the continuity ledger. resume" });
      expect(await prompt(core, "s2")).toContain(LEDGER_MARK);
      await core.onPrompt({ sessionID: "s3", text: "hello" });
      await core.onPrompt({ sessionID: "s3", text: "/ledger" });
      expect(await prompt(core, "s3")).not.toContain(LEDGER_MARK);
    } finally {
      await core.dispose();
    }
  });

  it("skips every injection for the reviewer's internal session", async () => {
    await mkdir(join(dir, ".mindmodel"), { recursive: true });
    await writeFile(
      join(dir, ".mindmodel", "manifest.yaml"),
      "name: t\nversion: 2\ncategories:\n  - path: test.md\n    description: Test constraints\n",
    );
    await writeFile(join(dir, ".mindmodel", "test.md"), "# Test\n");
    const ref: { core?: Micode } = {};
    const seen: string[][] = [];
    const host: SessionHost = {
      ...fakeHost(),
      runAgent: async (run) => {
        run.onCreated?.("ses_review");
        ref.core?.compactionInstruction("ses_review");
        seen.push((await ref.core?.systemPrompt({ sessionID: "ses_review", system: ["base"] })) ?? []);
        return { sessionID: "ses_review", text: '{"status":"PASS","violations":[],"summary":"ok"}' };
      },
    };
    const core = await createMicode({ directory: dir, host });
    ref.core = core;
    try {
      await core.onToolResult({ tool: "write", sessionID: "s1", args: { filePath: "/x/a.ts" }, output: "ok" });
      expect(seen).toEqual([["base"]]);
      // Once removed, the id is an ordinary session again.
      expect(await prompt(core, "ses_review")).toContain(ARCH_MARK);
    } finally {
      await core.dispose();
    }
  });
});

describe("trackInternalSessions", () => {
  it("marks a run's session internal from creation until it is removed", async () => {
    const internal = new Set<string>();
    const created: string[] = [];
    const removed: string[] = [];
    const host: SessionHost = {
      ...fakeHost(),
      runAgent: async (run) => {
        run.onCreated?.("ses_probe");
        expect(internal.has("ses_probe")).toBe(true);
        return { sessionID: "ses_probe", text: "" };
      },
      remove: async (id) => {
        removed.push(id);
      },
    };
    const tracked = trackInternalSessions(host, internal);

    await tracked.runAgent({ agent: "probe", text: "q", onCreated: (id) => created.push(id) });
    expect(created).toEqual(["ses_probe"]);
    expect(internal.has("ses_probe")).toBe(true);

    await tracked.remove("ses_probe");
    expect(internal.has("ses_probe")).toBe(false);
    expect(removed).toEqual(["ses_probe"]);
  });
});
