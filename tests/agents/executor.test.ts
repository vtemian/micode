import { describe, it, expect } from "bun:test";

describe("executor agent", () => {
  it("should use background_task instead of Task", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/executor.ts", "utf-8");

    expect(source).toContain("background_task");
    expect(source).toContain("background_output");
    expect(source).toContain("background_list");
  });

  it("should have fire-and-check pattern documentation", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/executor.ts", "utf-8");

    expect(source).toContain("fire-and-check");
  });

  it("should enforce background_task only (no Task fallback)", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/executor.ts", "utf-8");

    // Should NOT have Task fallback - always use background_task
    expect(source).not.toContain("<fallback-rule>");
    expect(source).not.toContain("Task(description=");
  });

  it("should have background-tools section", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/executor.ts", "utf-8");

    expect(source).toContain("<background-tools>");
  });

  it("should describe starting reviewer when implementer finishes", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/executor.ts", "utf-8");

    expect(source).toMatch(/reviewer.*immediately|immediately.*reviewer/i);
  });
});
