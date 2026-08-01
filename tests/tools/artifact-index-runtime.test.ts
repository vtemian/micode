// tests/tools/artifact-index-runtime.test.ts
// The artifact index needs Bun's sqlite. Under Node it must fail with a
// diagnosable error rather than taking the plugin down, which is the whole
// point of loading bun:sqlite lazily.
import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createArtifactIndex } from "../../src/tools/artifact-index";
import { runCommand } from "../../src/utils/process";

const ROOT = join(import.meta.dirname, "../..");
const OUT_DIR = join(ROOT, "node_modules/.cache/micode-artifact-index-check");
const PROBE_SOURCE = join(OUT_DIR, "probe.ts");
const PROBE_BUNDLE = join(OUT_DIR, "probe.js");
const NODE_TIMEOUT_MS = 60_000;

async function buildNodeProbe(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  const modulePath = JSON.stringify(join(ROOT, "src/tools/artifact-index"));
  writeFileSync(
    PROBE_SOURCE,
    `import { createArtifactIndex, getArtifactIndex } from ${modulePath};
     export async function probe(dir) {
       try {
         await createArtifactIndex(dir).initialize();
         return "UNEXPECTED_SUCCESS";
       } catch (error) {
         return error.message;
       }
     }
     // Two calls in a row: the second must report the same real cause, not a
     // downstream "not initialized" from a cached half-built index.
     export async function probeRepeat() {
       const messages = [];
       for (let i = 0; i < 2; i++) {
         try {
           const index = await getArtifactIndex();
           await index.search("x");
           messages.push("UNEXPECTED_SUCCESS");
         } catch (error) {
           messages.push(error.message);
         }
       }
       return messages.join(" || ");
     }`,
    "utf8",
  );

  const built = await Bun.build({ entrypoints: [PROBE_SOURCE], target: "node", outdir: OUT_DIR });
  expect(built.success).toBe(true);
}

describe("artifact index runtime requirements", () => {
  afterAll(() => {
    rmSync(OUT_DIR, { recursive: true, force: true });
  });

  it("initializes normally under bun", async () => {
    const dir = mkdtempSync(join(tmpdir(), "artifact-index-bun-"));
    const index = createArtifactIndex(dir);
    try {
      await index.initialize();
      await index.indexPlan({ id: "p1", filePath: join(dir, "plan.md"), title: "Plan" });
      expect(await index.search("Plan")).toHaveLength(1);
    } finally {
      await index.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails under node with an error naming the missing capability", async () => {
    await buildNodeProbe();
    const dir = mkdtempSync(join(tmpdir(), "artifact-index-node-"));

    try {
      const { stdout, exitCode } = await runCommand(
        "node",
        ["-e", `import(${JSON.stringify(PROBE_BUNDLE)}).then(m => m.probe(${JSON.stringify(dir)})).then(console.log)`],
        { timeoutMs: NODE_TIMEOUT_MS },
      );

      expect(exitCode).toBe(0);
      expect(stdout).not.toContain("UNEXPECTED_SUCCESS");
      // Must name the capability and the consequence, not leak a raw loader error.
      expect(stdout).toContain("Artifact index requires Bun's sqlite");
      expect(stdout).toContain("will not be indexed or searchable");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps reporting the real cause when initialization keeps failing", async () => {
    await buildNodeProbe();

    const { stdout, exitCode } = await runCommand(
      "node",
      ["-e", `import(${JSON.stringify(PROBE_BUNDLE)}).then(m => m.probeRepeat()).then(console.log)`],
      { timeoutMs: NODE_TIMEOUT_MS },
    );

    expect(exitCode).toBe(0);
    const [first, second] = stdout.trim().split(" || ");
    expect(first).toContain("Artifact index requires Bun's sqlite");
    // Caching a failed index would make this one "Database not initialized".
    expect(second).toContain("Artifact index requires Bun's sqlite");
  });
});
