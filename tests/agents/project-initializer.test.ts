import { describe, it, expect } from "bun:test";

describe("project-initializer agent", () => {
  it("should use background_task instead of Task", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/project-initializer.ts", "utf-8");

    expect(source).toContain("background_task");
    expect(source).toContain("background_output");
  });

  it("should have fire-and-collect pattern documentation", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/project-initializer.ts", "utf-8");

    expect(source).toContain("fire-and-collect");
  });

  it("should enforce background_task only (no Task fallback)", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/project-initializer.ts", "utf-8");

    // Should NOT have Task fallback - always use background_task
    expect(source).not.toContain("<fallback-rule>");
    expect(source).toContain("NEVER use Task");
  });

  it("should have background-tools section", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/agents/project-initializer.ts", "utf-8");

    expect(source).toContain("<background-tools>");
  });
});
