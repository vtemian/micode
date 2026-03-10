// tests/tools/pty/integration.test.ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { spawn } from "bun-pty";

import { PTYManager } from "../../../src/tools/pty/manager";
import { createPtyKillTool } from "../../../src/tools/pty/tools/kill";
import { createPtyReadTool } from "../../../src/tools/pty/tools/read";
import { createPtySpawnTool } from "../../../src/tools/pty/tools/spawn";
import { createPtyWriteTool } from "../../../src/tools/pty/tools/write";

describe("PTY Integration", () => {
  let manager: PTYManager;
  let pty_spawn: ReturnType<typeof createPtySpawnTool>;
  let pty_write: ReturnType<typeof createPtyWriteTool>;
  let pty_read: ReturnType<typeof createPtyReadTool>;
  let pty_kill: ReturnType<typeof createPtyKillTool>;

  const mockContext = {
    sessionID: "test-session",
    messageID: "test-message",
  } as any;

  beforeEach(() => {
    manager = new PTYManager();
    manager.init(spawn);
    pty_spawn = createPtySpawnTool(manager);
    pty_write = createPtyWriteTool(manager);
    pty_read = createPtyReadTool(manager);
    pty_kill = createPtyKillTool(manager);
  });

  afterEach(() => {
    manager.cleanupAll();
  });

  function extractId(output: string): string {
    const match = output.match(/ID: (pty_[a-f0-9]+)/);
    if (!match) throw new Error(`Could not extract PTY ID from: ${output}`);
    return match[1];
  }

  describe("spawn → write → read → kill flow", () => {
    it("should complete full lifecycle with cat", async () => {
      // 1. Spawn a cat process (echoes input back)
      const spawnResult = await pty_spawn.execute({ command: "cat", description: "Interactive cat" }, mockContext);
      expect(spawnResult).toContain("ID:");
      const id = extractId(spawnResult);

      // 2. Write some input
      const writeResult = await pty_write.execute({ id, data: "hello world\\n" }, mockContext);
      expect(writeResult).toContain("Sent");

      // 3. Wait for output to be captured
      await new Promise((resolve) => setTimeout(resolve, 100));

      // 4. Read the output
      const readResult = await pty_read.execute({ id }, mockContext);
      expect(readResult).toContain("<pty_output");
      expect(readResult).toContain("hello world");

      // 5. Kill the session
      const killResult = await pty_kill.execute({ id }, mockContext);
      expect(killResult).toContain("killed");

      // 6. Verify session is killed
      const session = manager.get(id);
      expect(session?.status).toBe("killed");
    });

    it("should handle multiple write/read cycles", async () => {
      const spawnResult = await pty_spawn.execute({ command: "cat", description: "Multi-cycle test" }, mockContext);
      const id = extractId(spawnResult);

      // Write and read multiple times
      for (let i = 1; i <= 3; i++) {
        await pty_write.execute({ id, data: `line ${i}\\n` }, mockContext);
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      const readResult = await pty_read.execute({ id }, mockContext);
      expect(readResult).toContain("line 1");
      expect(readResult).toContain("line 2");
      expect(readResult).toContain("line 3");

      await pty_kill.execute({ id }, mockContext);
    });

    it("should handle Ctrl+C interrupt", async () => {
      const spawnResult = await pty_spawn.execute({ command: "cat", description: "Interrupt test" }, mockContext);
      const id = extractId(spawnResult);

      // Send Ctrl+C
      const writeResult = await pty_write.execute({ id, data: "\\x03" }, mockContext);
      expect(writeResult).toContain("Sent");

      // Wait for process to exit
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Session should have exited
      const session = manager.get(id);
      expect(["exited", "killed"]).toContain(session?.status);
    });
  });

  describe("error handling", () => {
    it("should reject write to killed session", async () => {
      const spawnResult = await pty_spawn.execute({ command: "cat", description: "Kill test" }, mockContext);
      const id = extractId(spawnResult);

      await pty_kill.execute({ id }, mockContext);

      await expect(pty_write.execute({ id, data: "test" }, mockContext)).rejects.toThrow("killed");
    });

    it("should reject operations on non-existent session", async () => {
      const fakeId = "pty_00000000";

      await expect(pty_read.execute({ id: fakeId }, mockContext)).rejects.toThrow("not found");

      await expect(pty_write.execute({ id: fakeId, data: "test" }, mockContext)).rejects.toThrow("not found");

      await expect(pty_kill.execute({ id: fakeId }, mockContext)).rejects.toThrow("not found");
    });
  });
});
