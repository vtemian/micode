/**
 * Scripted /mindmodel run: the stub provider walks the mm-orchestrator through
 * both phases, two analysis subagents answer with canned findings, and the
 * constraint-writer's writes land on disk for real. The assertions go through
 * the production loader, so a manifest the stub fakes badly fails the same way
 * it would for a user.
 *
 * Runs inside the e2e Docker image (bun run test:e2e); locally it needs the
 * opencode CLI on PATH and a built dist/.
 */
import { afterAll, describe, expect, it } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { loadMindmodel } from "../../src/mindmodel";
import { describeRun, ensureBuilt, type Run, runCommand, type StubHandle, startStub } from "./harness";

// opencode installs @opencode-ai/plugin into each cold HOME, so most of the
// budget is first-run npm latency, not the stub, which answers instantly.
const RUN_TIMEOUT_MS = 240_000;
const SPEC_TIMEOUT_MS = RUN_TIMEOUT_MS + 60_000;
const DONE_MARKER = "E2E_SCRIPTED_DONE";
const SCRIPT = join(import.meta.dirname, "..", "scripts", "mindmodel.json");

describe("micode /mindmodel against the scripted stub", () => {
  let stub: StubHandle | undefined;
  let run: Run | undefined;

  // Nothing asserts after cleanup: an expect here would abort the rmSync calls
  // and leak tens of MB of per-run HOME on the very failure path that needs
  // the diagnosis.
  afterAll(() => {
    if (run) {
      rmSync(run.projectDir, { recursive: true, force: true });
      rmSync(run.homeDir, { recursive: true, force: true });
    }
    stub?.stop();
  });

  it(
    "drives both phases and lands a manifest the production loader accepts",
    async () => {
      ensureBuilt();
      stub = await startStub(SCRIPT);

      run = await runCommand("mindmodel", "Generate mindmodel for this project.", RUN_TIMEOUT_MS);

      expect(run.timedOut, describeRun(run)).toBe(false);

      // opencode swallows a plugin load failure and still exits 0, so the exit
      // code alone proves nothing about whether micode was even active.
      expect(run.stderr, describeRun(run)).not.toContain("failed to load plugin");
      expect(run.exitCode, describeRun(run)).toBe(0);
      expect(run.stdout, describeRun(run)).not.toContain('"type":"error"');

      // The orchestrator runs in a child session, but its final text crosses
      // into the primary stream inside the task tool's result.
      expect(run.stdout, describeRun(run)).toContain(DONE_MARKER);

      const mindmodelDir = join(run.projectDir, ".mindmodel");
      expect(existsSync(join(mindmodelDir, "manifest.yaml")), describeRun(run)).toBe(true);

      const mindmodel = await loadMindmodel(run.projectDir);
      if (mindmodel === null) {
        throw new Error(
          [
            "loadMindmodel rejected the scripted manifest.",
            "--- manifest.yaml ---",
            readFileSync(join(mindmodelDir, "manifest.yaml"), "utf8"),
          ].join("\n"),
        );
      }

      const paths = mindmodel.manifest.categories.map((category) => category.path);
      expect(paths, describeRun(run)).toEqual(["stack/backend.md", "patterns/repository.md"]);

      const backend = readFileSync(join(mindmodelDir, "stack", "backend.md"), "utf8");
      expect(backend).toContain("invoice-service");
      expect(existsSync(join(mindmodelDir, "patterns", "repository.md")), describeRun(run)).toBe(true);
    },
    SPEC_TIMEOUT_MS,
  );
});
