/**
 * Regression spec for https://github.com/vtemian/micode/issues/59
 * "spawn_agent spawned by subagents do not show on OpenCode / cannot be monitored".
 *
 * spawn_agent creates each subagent session through the plain session API
 * without a parent_id and deletes it right after the result arrives, so the
 * sessions never appear in opencode's session tree. The task tool, by
 * contrast, parents its child session correctly. Here the orchestrator spawns
 * a subagent that itself spawns another; both spawn_agent sessions should be
 * persisted and parented to the session that spawned them.
 *
 * This spec FAILS while spawn_agent sessions are transient and unparented.
 */

import { Database } from "bun:sqlite";
import { afterAll, describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";

import { describeRun, ensureBuilt, type Run, runCommand, type StubHandle, startStub } from "./harness";

const RUN_TIMEOUT_MS = 240_000;
const SPEC_TIMEOUT_MS = RUN_TIMEOUT_MS + 60_000;
const SCRIPT = join(import.meta.dirname, "..", "scripts", "issue-59-nested.json");

interface SessionRow {
  readonly id: string;
  readonly parent_id: string | null;
  readonly title: string;
}

/** The DEBUG log carries one "stream" line per session with its agent. */
function sessionIdForAgent(run: Run, agent: string): string | undefined {
  const match = run.stderr.match(new RegExp(`session\\.id=(\\S+).*agent=${agent} `));
  return match?.[1];
}

describe("issue #59: spawn_agent sessions are persisted and parented", () => {
  let stub: StubHandle | undefined;
  let run: Run | undefined;

  afterAll(() => {
    if (run) {
      rmSync(run.projectDir, { recursive: true, force: true });
      rmSync(run.homeDir, { recursive: true, force: true });
    }
    stub?.stop();
  });

  it(
    "records nested spawn_agent sessions in the session store with parentage",
    async () => {
      ensureBuilt();
      stub = await startStub(SCRIPT);

      run = await runCommand("mindmodel", "Generate mindmodel for this project.", RUN_TIMEOUT_MS);

      expect(run.timedOut, describeRun(run)).toBe(false);
      expect(run.exitCode, describeRun(run)).toBe(0);

      // The subagent sessions undeniably ran: the DEBUG log streamed them.
      const stackSession = sessionIdForAgent(run, "mm-stack-detector");
      const domainSession = sessionIdForAgent(run, "mm-domain-extractor");
      expect(stackSession, describeRun(run)).toBeDefined();
      expect(domainSession, describeRun(run)).toBeDefined();

      const db = new Database(join(run.homeDir, ".local", "share", "opencode", "opencode.db"), { readonly: true });
      const sessions = db.query("SELECT id, parent_id, title FROM session").all() as SessionRow[];
      db.close();

      // The task-tool child shows how it should look: persisted, parented.
      const orchestrator = sessions.find((s) => s.title.includes("mm-orchestrator"));
      expect(orchestrator, describeRun(run)).toBeDefined();

      const stack = sessions.find((s) => s.id === stackSession);
      const domain = sessions.find((s) => s.id === domainSession);
      expect(stack, `mm-stack-detector session ${stackSession} missing from the store`).toBeDefined();
      expect(domain, `mm-domain-extractor session ${domainSession} missing from the store`).toBeDefined();

      expect(stack?.parent_id).toBe(orchestrator?.id);
      expect(domain?.parent_id).toBe(stack?.id);
    },
    SPEC_TIMEOUT_MS,
  );
});
