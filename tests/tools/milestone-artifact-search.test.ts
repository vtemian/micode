import { describe, expect, it } from "bun:test";

describe("milestone-artifact-search tool", () => {
  it("defines milestone_id and artifact_type args", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/tools/milestone-artifact-search.ts", "utf-8");
    expect(source).toContain("milestone_id");
    expect(source).toContain("artifact_type");
  });
});
