// tests/tools/pty/write.test.ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { spawn } from "bun-pty";

import { PTYManager } from "../../../src/tools/pty/manager";
import { createPtySpawnTool } from "../../../src/tools/pty/tools/spawn";
import { createPtyWriteTool } from "../../../src/tools/pty/tools/write";

describe("pty_write tool", () => {
  let manager: PTYManager;
  let pty_write: ReturnType<typeof createPtyWriteTool>;
  let pty_spawn: ReturnType<typeof createPtySpawnTool>;

  beforeEach(() => {
    manager = new PTYManager();
    manager.init(spawn);
    pty_write = createPtyWriteTool(manager);
    pty_spawn = createPtySpawnTool(manager);
  });

  afterEach(() => {
    manager.cleanupAll();
  });

  it("should have correct description", () => {
    expect(pty_write.description).toContain("input");
    expect(pty_write.description).toContain("PTY");
  });

  it("should require id and data parameters", () => {
    expect(pty_write.args).toHaveProperty("id");
    expect(pty_write.args).toHaveProperty("data");
  });

  it("should throw error for unknown session", async () => {
    await expect(pty_write.execute({ id: "pty_nonexistent", data: "test" }, {} as any)).rejects.toThrow("not found");
  });

  it("should write to a running session", async () => {
    const spawnResult = await pty_spawn.execute({ command: "cat", description: "Test cat" }, {
      sessionID: "test",
      messageID: "msg",
    } as any);

    const idMatch = spawnResult.match(/ID: (pty_[a-f0-9]+)/);
    const id = idMatch?.[1];
    expect(id).toBeDefined();

    const result = await pty_write.execute({ id: id!, data: "hello\\n" }, {} as any);

    expect(result).toContain("Sent");
    expect(result).toContain(id!);
  });

  it("should parse escape sequences", async () => {
    const spawnResult = await pty_spawn.execute({ command: "cat", description: "Test cat" }, {
      sessionID: "test",
      messageID: "msg",
    } as any);

    const idMatch = spawnResult.match(/ID: (pty_[a-f0-9]+)/);
    const id = idMatch?.[1];

    // Send Ctrl+C
    const result = await pty_write.execute({ id: id!, data: "\\x03" }, {} as any);

    expect(result).toContain("Sent");
  });
});
