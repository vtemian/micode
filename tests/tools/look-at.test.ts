// tests/tools/look-at.test.ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createLookAtTool } from "../../src/tools/look-at";

const CTX = { sessionID: "s1", progress: () => {} };

describe("look_at", () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "micode-look-at-"));
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it("resolves a relative path against the workspace, not the process cwd", async () => {
    writeFileSync(join(directory, "workspace-only.txt"), "hello from the workspace");
    const tool = createLookAtTool({ directory });
    const output = await tool.execute({ filePath: "workspace-only.txt" }, CTX);
    expect(output).toContain("hello from the workspace");
  });

  it("keeps absolute paths as given", async () => {
    const file = join(directory, "abs.txt");
    writeFileSync(file, "absolute content");
    const tool = createLookAtTool({ directory: "/nonexistent-workspace" });
    expect(await tool.execute({ filePath: file }, CTX)).toContain("absolute content");
  });

  it("reports a missing file as an error string", async () => {
    const tool = createLookAtTool({ directory });
    expect(await tool.execute({ filePath: "missing.txt" }, CTX)).toStartWith("Error:");
  });
});
