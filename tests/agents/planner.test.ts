import { describe, it, expect } from "bun:test";

describe("planner agent", () => {
  it("should use Task tool for subagent research", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/planner.ts", "utf-8");

    expect(source).toContain("Task tool");
    expect(source).toContain("subagent_type=");
  });

  it("should have parallel research documentation", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/planner.ts", "utf-8");

    expect(source).toContain("parallel");
  });

  it("should enforce synchronous Task tool usage", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/planner.ts", "utf-8");

    expect(source).toContain("synchronously");
  });

  it("should mention running library research in parallel with agents", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/planner.ts", "utf-8");

    expect(source).toContain("context7");
    expect(source).toContain("btca_ask");
  });
});
