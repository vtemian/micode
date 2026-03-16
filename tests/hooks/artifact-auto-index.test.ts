import { describe, expect, it } from "bun:test";

describe("artifact-auto-index", () => {
  it("should not have handoff pattern or parsing", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/hooks/artifact-auto-index.ts", "utf-8");
    expect(source).not.toContain("HANDOFF_PATH_PATTERN");
    expect(source).not.toContain("parseHandoff");
    expect(source).not.toContain("indexHandoff");
    expect(source).not.toContain("handoffMatch");
  });

  it("should still have ledger and plan patterns", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/hooks/artifact-auto-index.ts", "utf-8");
    expect(source).toContain("LEDGER_PATH_PATTERN");
    expect(source).toContain("PLAN_PATH_PATTERN");
    expect(source).toContain("parseLedger");
    expect(source).toContain("parsePlan");
  });
});
