import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AgentRun, SessionHost } from "../src/host/port";
import { createMicode, type Micode } from "../src/micode";
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
