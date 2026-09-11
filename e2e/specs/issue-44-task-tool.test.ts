/**
 * Regression spec for https://github.com/vtemian/micode/issues/44
 * "The Task tool isn't registered".
 *
 * The primary agent's prompt tells it to spawn subagents with the built-in
 * Task tool ("Primary agents use built-in Task tool, not spawn_agent"), but
 * when a model actually calls task, opencode answers that the tool is not
 * registered. The stub scripts exactly that call; a healthy run must execute
 * it and return the subagent's result to the primary session.
 *
 * This spec FAILS while task is unregistered for the primary agent.
 */
import { afterAll, describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";

import { describeRun, ensureBuilt, type Run, runPrompt, type StubHandle, startStub } from "./harness";

const RUN_TIMEOUT_MS = 240_000;
const SPEC_TIMEOUT_MS = RUN_TIMEOUT_MS + 60_000;
const SCRIPT = join(import.meta.dirname, "..", "scripts", "issue-44-task.json");

describe("issue #44: the primary agent can call the task tool", () => {
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
    "executes task and returns the subagent result instead of a registration error",
    async () => {
      ensureBuilt();
      stub = await startStub(SCRIPT);

      run = await runPrompt("Find where invoices are stored.", RUN_TIMEOUT_MS);

      expect(run.timedOut, describeRun(run)).toBe(false);
      expect(run.exitCode, describeRun(run)).toBe(0);

      // The bug: the task call fails with a registration error and the
      // subagent never runs. The locator's canned text proves it executed.
      expect(run.stdout, describeRun(run)).not.toContain("not registered");
      expect(run.stdout, describeRun(run)).toContain("LOCATOR_FOUND");
    },
    SPEC_TIMEOUT_MS,
  );
});
