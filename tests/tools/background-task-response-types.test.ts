import { describe, it, expect } from "bun:test";

describe("background-task response types", () => {
  it("should have SessionCreateResponse type", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/tools/background-task/types.ts", "utf-8");
    expect(source).toContain("SessionCreateResponse");
  });

  it("should have SessionGetResponse type", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/tools/background-task/types.ts", "utf-8");
    expect(source).toContain("SessionGetResponse");
  });

  it("should have SessionMessagesResponse type", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/tools/background-task/types.ts", "utf-8");
    expect(source).toContain("SessionMessagesResponse");
  });

  it("should use typed responses in manager", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/tools/background-task/manager.ts", "utf-8");
    // Should import the response types
    expect(source).toContain("SessionCreateResponse");
    expect(source).toContain("SessionGetResponse");
    expect(source).toContain("SessionMessagesResponse");
  });
});
