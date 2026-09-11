/**
 * Regression spec for https://github.com/vtemian/micode/issues/41
 * "micode agents 'plan' and 'build' conflict with native OpenCode agents".
 *
 * micode's config hook demotes the native build/plan/triage/docs agents to
 * mode "subagent", which removes them from opencode's agent picker and makes
 * `opencode run --agent build` silently fall back to the plugin's primary
 * agent. The DEBUG log's "stream" line names the agent a session really ran
 * as, so the fallback is observable end to end.
 *
 * This spec FAILS while build is demoted out of primary reach.
 */
import { afterAll, describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";

import { describeRun, ensureBuilt, type Run, runAgent, type StubHandle, startStub } from "./harness";

const RUN_TIMEOUT_MS = 240_000;
const SPEC_TIMEOUT_MS = RUN_TIMEOUT_MS + 60_000;
const SCRIPT = join(import.meta.dirname, "..", "scripts", "issue-41-build.json");

describe("issue #41: the native build agent stays selectable", () => {
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
    "runs --agent build instead of falling back to the plugin primary agent",
    async () => {
      ensureBuilt();
      stub = await startStub(SCRIPT);

      run = await runAgent("build", "Say hello.", RUN_TIMEOUT_MS);

      expect(run.timedOut, describeRun(run)).toBe(false);
      expect(run.exitCode, describeRun(run)).toBe(0);

      // Fallback lands on brainstormer (first primary agent alphabetically),
      // so the run only counts if build itself answered.
      expect(run.stderr, describeRun(run)).toContain("agent=build");
      expect(run.stderr, describeRun(run)).not.toContain("agent=brainstormer");
    },
    SPEC_TIMEOUT_MS,
  );
});
