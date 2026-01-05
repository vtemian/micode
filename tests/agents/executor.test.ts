import { describe, it, expect } from "bun:test";

describe("executor agent", () => {
  it("should use spawn_agent tool for subagents", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/executor.ts", "utf-8");

    expect(source).toContain("spawn_agent tool");
    expect(source).toContain('agent="implementer"');
    expect(source).toContain('agent="reviewer"');
  });

  it("should have parallel execution documentation", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/executor.ts", "utf-8");

    expect(source).toContain("parallel");
  });

  it("should describe reviewer after implementer", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/executor.ts", "utf-8");

    expect(source).toContain("reviewer");
    expect(source).toContain("implementer");
  });
});
