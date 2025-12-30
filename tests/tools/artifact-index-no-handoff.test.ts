import { describe, it, expect } from "bun:test";

describe("artifact-index without handoffs", () => {
  it("should not export HandoffRecord interface", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/tools/artifact-index/index.ts", "utf-8");
    expect(source).not.toContain("export interface HandoffRecord");
    expect(source).not.toContain("async indexHandoff");
  });

  it("should not have handoff in SearchResult type", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/tools/artifact-index/index.ts", "utf-8");
    expect(source).not.toContain('type: "handoff"');
  });

  it("should have LedgerRecord with file operation fields", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/tools/artifact-index/index.ts", "utf-8");
    expect(source).toContain("filesRead?: string");
    expect(source).toContain("filesModified?: string");
  });
});
