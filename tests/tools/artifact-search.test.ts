import { describe, expect, it } from "bun:test";

describe("artifact-search tool", () => {
  it("should not have handoff in type enum", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/tools/artifact-search.ts", "utf-8");
    expect(source).not.toContain('"handoff"');
    expect(source).toContain('"plan"');
    expect(source).toContain('"ledger"');
  });

  it("should not mention handoffs in description", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/tools/artifact-search.ts", "utf-8");
    expect(source).not.toContain("handoffs");
  });
});
