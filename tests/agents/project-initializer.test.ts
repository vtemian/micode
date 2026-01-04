import { describe, it, expect } from "bun:test";

describe("project-initializer agent", () => {
  it("should use Task tool for subagents", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/project-initializer.ts", "utf-8");

    expect(source).toContain("Task tool");
    expect(source).toContain("subagent_type=");
  });

  it("should have parallel execution documentation", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/project-initializer.ts", "utf-8");

    expect(source).toContain("parallel");
  });
});
