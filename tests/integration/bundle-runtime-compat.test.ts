// tests/integration/bundle-runtime-compat.test.ts
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { runCommand } from "../../src/utils/process";

const ROOT = join(import.meta.dirname, "../..");
const ENTRY = join(ROOT, "src/index.ts");
// Inside node_modules so Node resolves the externalised bare specifiers the
// same way a consumer's install would.
const OUT_DIR = join(ROOT, "node_modules/.cache/micode-bundle-check");
const OUT_FILE = join(OUT_DIR, "index.js");

const STATIC_BUN_IMPORT = /^\s*import[^;]*from\s*["']bun:[a-z]+["']/m;
// Bun-only members of import.meta. Node leaves both undefined, so any survivor
// throws at whatever point it is reached.
const BUN_ONLY_IMPORT_META = /import\.meta\.(require|path|dir)\b/;
const LOAD_TIMEOUT_MS = 60_000;

/**
 * The flags the published bundle is actually built with, read from the build
 * script so this test cannot drift away from what ships.
 */
function shippedBuildFlags(): { target: string; external: string[] } {
  const manifest: unknown = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const script = (manifest as { scripts: Record<string, string> }).scripts.build;

  const target = /--target\s+(\S+)/.exec(script)?.[1];
  if (target === undefined) throw new Error(`build script declares no --target: ${script}`);

  const external = [...script.matchAll(/--external\s+(\S+)/g)].map((match) => match[1]);
  return { target, external };
}

let bundle = "";

beforeAll(async () => {
  const { target, external } = shippedBuildFlags();
  const built = await Bun.build({
    entrypoints: [ENTRY],
    target: target as "node" | "bun",
    external,
  });
  expect(built.success).toBe(true);

  bundle = await built.outputs[0].text();
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_FILE, bundle, "utf8");
});

afterAll(() => {
  rmSync(OUT_DIR, { recursive: true, force: true });
});

describe("bundle runtime compatibility", () => {
  // OpenCode Desktop runs on Electron. A static bun: specifier is rejected
  // while the loader resolves the graph, before any code runs.
  it("emits no static bun: import", () => {
    expect(bundle).not.toMatch(STATIC_BUN_IMPORT);
  });

  it("emits no Bun-only import.meta member", () => {
    expect(bundle).not.toMatch(BUN_ONLY_IMPORT_META);
  });

  it("still reaches bun:sqlite through a deferred import", () => {
    expect(bundle).toContain('import("bun:sqlite")');
  });

  // The greps above only catch failure modes we already know about. Actually
  // loading the artifact under each runtime catches the ones we do not.
  it("loads under node", async () => {
    const { stdout, stderr, exitCode } = await runCommand(
      "node",
      ["-e", `import(${JSON.stringify(OUT_FILE)}).then(m => console.log(Object.keys(m).join(",")))`],
      { timeoutMs: LOAD_TIMEOUT_MS },
    );

    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("OpenCodeConfigPlugin");
  });

  it("loads under bun", async () => {
    const { stdout, stderr, exitCode } = await runCommand(
      "bun",
      ["-e", `import(${JSON.stringify(OUT_FILE)}).then(m => console.log(Object.keys(m).join(",")))`],
      { timeoutMs: LOAD_TIMEOUT_MS },
    );

    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("OpenCodeConfigPlugin");
  });
});
