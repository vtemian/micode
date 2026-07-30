// tests/integration/bundle-runtime-compat.test.ts
import { describe, expect, it } from "bun:test";
import { join } from "node:path";

const ENTRY = join(import.meta.dir, "../../src/index.ts");
const STATIC_BUN_IMPORT = /^\s*import[^;]*from\s*["']bun:[a-z]+["']/m;

async function bundle(): Promise<string> {
  const built = await Bun.build({ entrypoints: [ENTRY], target: "bun", external: ["bun-pty"] });
  expect(built.success).toBe(true);
  return await built.outputs[0].text();
}

describe("bundle runtime compatibility", () => {
  // A static `bun:` specifier is rejected by the Node and Electron ESM loaders
  // while they resolve the module graph, which takes the whole plugin down
  // before it can register. Any such import must be deferred to call time.
  it("emits no static bun: import that non-Bun ESM loaders reject", async () => {
    const output = await bundle();
    expect(output).not.toMatch(STATIC_BUN_IMPORT);
  });

  it("still reaches bun:sqlite through a deferred import", async () => {
    const output = await bundle();
    expect(output).toContain('import("bun:sqlite")');
  });
});
