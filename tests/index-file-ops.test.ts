import { describe, expect, it } from "bun:test";

describe("micode file-ops integration", () => {
  it("should import file-ops-tracker hook", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/micode.ts", "utf-8");
    expect(source).toContain("createFileOpsTrackerHook");
    expect(source).toContain('fileOps["tool.execute.after"]');
  });
});
