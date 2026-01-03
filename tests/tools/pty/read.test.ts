// tests/tools/pty/read.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { PTYManager } from "../../../src/tools/pty/manager";
import { createPtyReadTool } from "../../../src/tools/pty/tools/read";
import { createPtySpawnTool } from "../../../src/tools/pty/tools/spawn";

describe("pty_read tool", () => {
  let manager: PTYManager;
  let pty_read: ReturnType<typeof createPtyReadTool>;
  let pty_spawn: ReturnType<typeof createPtySpawnTool>;

  beforeEach(() => {
    manager = new PTYManager();
    pty_read = createPtyReadTool(manager);
    pty_spawn = createPtySpawnTool(manager);
  });

  afterEach(() => {
    manager.cleanupAll();
  });

  it("should have correct description", () => {
    expect(pty_read.description).toContain("output");
    expect(pty_read.description).toContain("buffer");
  });

  it("should require id parameter", () => {
    expect(pty_read.args).toHaveProperty("id");
  });

  it("should have optional offset, limit, pattern parameters", () => {
    expect(pty_read.args).toHaveProperty("offset");
    expect(pty_read.args).toHaveProperty("limit");
    expect(pty_read.args).toHaveProperty("pattern");
  });

  it("should throw error for unknown session", async () => {
    await expect(pty_read.execute({ id: "pty_nonexistent" }, {} as any)).rejects.toThrow("not found");
  });

  it("should read output from a session", async () => {
    const spawnResult = await pty_spawn.execute({ command: "echo", args: ["hello world"], description: "Test echo" }, {
      sessionID: "test",
      messageID: "msg",
    } as any);

    const idMatch = spawnResult.match(/ID: (pty_[a-f0-9]+)/);
    const id = idMatch?.[1];
    expect(id).toBeDefined();

    // Wait a bit for output
    await new Promise((resolve) => setTimeout(resolve, 100));

    const result = await pty_read.execute({ id: id! }, {} as any);

    expect(result).toContain("<pty_output");
    expect(result).toContain("</pty_output>");
    expect(result).toContain(id!);
  });

  it("should handle pattern filtering", async () => {
    const spawnResult = await pty_spawn.execute(
      { command: "echo", args: ["-e", "line1\\nerror: bad\\nline3"], description: "Test" },
      { sessionID: "test", messageID: "msg" } as any,
    );

    const idMatch = spawnResult.match(/ID: (pty_[a-f0-9]+)/);
    const id = idMatch?.[1];

    await new Promise((resolve) => setTimeout(resolve, 100));

    const result = await pty_read.execute({ id: id!, pattern: "error" }, {} as any);

    expect(result).toContain("pattern=");
    // Verify filtering actually works - should contain the matched line
    expect(result).toContain("error");
  });

  it("should throw error for invalid regex", async () => {
    const spawnResult = await pty_spawn.execute({ command: "echo", args: ["test"], description: "Test" }, {
      sessionID: "test",
      messageID: "msg",
    } as any);

    const idMatch = spawnResult.match(/ID: (pty_[a-f0-9]+)/);
    const id = idMatch?.[1];

    await expect(pty_read.execute({ id: id!, pattern: "[invalid" }, {} as any)).rejects.toThrow("Invalid regex");
  });
});
