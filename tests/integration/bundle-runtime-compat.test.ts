// tests/integration/bundle-runtime-compat.test.ts
import { describe, expect, it } from "bun:test";
import { join } from "node:path";

const ENTRY = join(import.meta.dir, "../../src/index.ts");
const EXTERNAL = ["bun-pty", "jsonc-parser"];
const STATIC_BUN_IMPORT = /^\s*import[^;]*from\s*["']bun:[a-z]+["']/m;

// Mirrors the shipped build in package.json. OpenCode Desktop runs on
// Electron, so the published bundle has to resolve and execute under Node.
async function bundle(): Promise<string> {
  const built = await Bun.build({ entrypoints: [ENTRY], target: "node", external: EXTERNAL });
  expect(built.success).toBe(true);
  return await built.outputs[0].text();
}

describe("bundle runtime compatibility", () => {
  it("emits no static bun: import that non-Bun ESM loaders reject", async () => {
    const output = await bundle();
    expect(output).not.toMatch(STATIC_BUN_IMPORT);
  });

  // import.meta.require exists only in Bun; Node leaves it undefined and the
  // generated __require shim throws on first call.
  it("emits no import.meta.require shim", async () => {
    const output = await bundle();
    expect(output).not.toContain("import.meta.require");
  });

  it("still reaches bun:sqlite through a deferred import", async () => {
    const output = await bundle();
    expect(output).toContain('import("bun:sqlite")');
  });
});
