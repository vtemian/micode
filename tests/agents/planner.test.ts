import { describe, it, expect } from "bun:test";

describe("planner agent", () => {
  it("should use background_task instead of Task for research", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/planner.ts", "utf-8");

    expect(source).toContain("background_task");
    expect(source).toContain("background_output");
  });

  it("should have fire-and-collect pattern documentation", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/planner.ts", "utf-8");

    expect(source).toContain("fire-and-collect");
  });

  it("should have fallback-rule section", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/planner.ts", "utf-8");

    expect(source).toContain("<fallback-rule>");
  });

  it("should have background-tools section", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/planner.ts", "utf-8");

    expect(source).toContain("<background-tools>");
  });

  it("should mention running library research in parallel with agents", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/planner.ts", "utf-8");

    expect(source).toContain("context7");
    expect(source).toContain("btca_ask");
  });
});
