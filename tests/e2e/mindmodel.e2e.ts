// tests/e2e/mindmodel.e2e.ts
// Runs /mindmodel against a real model and asserts on what lands on disk,
// through the production loader rather than a regex approximation.
//
// Not named *.test.ts on purpose: bun's discovery glob is
// **{.test,.spec,_test_,_spec_}.{js,ts,jsx,tsx}, so a .test.ts here would be
// collected by `bun run check` and call a live model on every PR.
import { afterEach, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

import { loadExamples, loadMindmodel } from "../../src/mindmodel";
import { captureLogs, type LogCapture } from "../helpers/log-capture";
import { describeRun, e2eModel, ensureBuilt, primarySessionCost, type Run, runCommand } from "./harness";

// Observed 382s, 397s and 715s across four live runs on the free tier, so
// the budget is generous: a slow model must not read as a product failure.
const RUN_TIMEOUT_MS = 1_500_000;
const SPEC_TIMEOUT_MS = RUN_TIMEOUT_MS + 60_000;
const MIN_CATEGORIES = 3;
const MANIFEST = "manifest.yaml";

function filesUnder(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...filesUnder(full));
    else found.push(full);
  }
  return found;
}

describe("micode /mindmodel against a live model", () => {
  let run: Run | undefined;
  let logs: LogCapture | undefined;

  beforeAll(() => {
    ensureBuilt();
  });

  afterEach(() => {
    // A clean load is silent, so anything captured and never inspected is a
    // degraded path the spec did not account for.
    const stray = logs?.unread() ?? [];
    logs?.restore();
    logs = undefined;
    expect(stray).toEqual([]);
    // opencode installs @opencode-ai/plugin into the per-run HOME on cold
    // start, so leaving it behind leaks tens of MB per spec.
    if (run) {
      rmSync(run.projectDir, { recursive: true, force: true });
      rmSync(run.homeDir, { recursive: true, force: true });
    }
    run = undefined;
  });

  it(
    "generates a schema-valid mindmodel whose constraint files are all markdown",
    async () => {
      run = await runCommand("mindmodel", "Generate mindmodel for this project.", RUN_TIMEOUT_MS);

      expect(run.timedOut, describeRun(run)).toBe(false);

      // opencode swallows a plugin load failure and still exits 0, so the exit
      // code alone proves nothing about whether micode was even active.
      expect(run.stderr, describeRun(run)).not.toContain("failed to load plugin");

      // spawn_agent's own failure strings cannot be asserted on: /mindmodel runs
      // as a subtask in a child session and the CLI drops events whose sessionID
      // is not the primary one, so only the orchestrator's final text crosses.
      // Exit status and the error event are what actually surface.
      expect(run.exitCode, describeRun(run)).toBe(0);
      expect(run.stdout, describeRun(run)).not.toContain('"type":"error"');

      const mindmodelDir = join(run.projectDir, ".mindmodel");
      expect(existsSync(join(mindmodelDir, MANIFEST)), describeRun(run)).toBe(true);

      // Assert through the production loader: if this returns null, the
      // generated manifest would not work for a real user either.
      logs = captureLogs();
      const mindmodel = await loadMindmodel(run.projectDir);
      if (mindmodel === null) {
        // The loader only ever says "Failed to load manifest: <reason>", so
        // surface the reason and the document beside it.
        throw new Error(
          [
            "loadMindmodel rejected the generated manifest.",
            `warnings: ${JSON.stringify(logs.warn)}`,
            `tree: ${JSON.stringify(filesUnder(mindmodelDir).map((path) => path.slice(mindmodelDir.length + 1)))}`,
            "--- manifest.yaml ---",
            readFileSync(join(mindmodelDir, MANIFEST), "utf8"),
          ].join("\n"),
        );
      }

      const categories = mindmodel?.manifest.categories ?? [];
      expect(categories.length).toBeGreaterThanOrEqual(MIN_CATEGORIES);

      // Issue #58, first half: every manifest path claims to be markdown.
      expect(categories.filter((category) => !category.path.endsWith(".md"))).toEqual([]);

      // Issue #58, second half. warnNonMarkdownCategories only inspects the
      // manifest's path strings, so a run that writes stack/frontend.yaml while
      // listing stack/frontend.md raises nothing. Check the disk separately.
      const strayYaml = filesUnder(mindmodelDir)
        .filter((path) => path.endsWith(".yaml") || path.endsWith(".yml"))
        .filter((path) => !path.endsWith(MANIFEST));
      expect(strayYaml, "only manifest.yaml may be YAML").toEqual([]);

      // Every manifest path resolves to a file that actually exists.
      const examples = await loadExamples(
        mindmodel,
        categories.map((category) => category.path),
      );
      expect(examples.length).toBe(categories.length);

      // The fixture has no frontend, so "skip empty categories" must hold.
      expect(categories.map((category) => category.path)).not.toContain("stack/frontend.md");

      // Only covers the orchestrator's own turn; subagent sessions are invisible
      // to the event stream. A regression to a paid primary model still trips it.
      if (e2eModel().endsWith("-free")) expect(primarySessionCost(run)).toBe(0);
    },
    SPEC_TIMEOUT_MS,
  );
});
