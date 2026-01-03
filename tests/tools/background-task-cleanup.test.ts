import { describe, it, expect } from "bun:test";

describe("background-task cleanup", () => {
  it("should have TASK_TTL_MS constant", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/tools/background-task/manager.ts", "utf-8");
    expect(source).toContain("TASK_TTL_MS");
  });

  it("should have cleanupOldTasks method", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/tools/background-task/manager.ts", "utf-8");
    expect(source).toContain("cleanupOldTasks");
  });

  it("should call cleanup in pollRunningTasks", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/tools/background-task/manager.ts", "utf-8");
    // Find pollRunningTasks method and verify it calls cleanupOldTasks
    const pollMethod = source.match(/async pollRunningTasks\(\)[^{]*\{[\s\S]*?^\s{2}\}/m);
    expect(pollMethod?.[0]).toContain("cleanupOldTasks");
  });
});
