import { describe, it, expect } from "bun:test";

describe("background-task types", () => {
  it("should not have lastMessage in progress type", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/tools/background-task/types.ts", "utf-8");
    expect(source).not.toContain("lastMessage");
  });

  it("should not reference lastMessage in manager", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/tools/background-task/manager.ts", "utf-8");
    expect(source).not.toContain("lastMessage");
  });
});
