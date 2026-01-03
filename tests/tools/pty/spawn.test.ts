// tests/tools/pty/spawn.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { PTYManager } from "../../../src/tools/pty/manager";
import { createPtySpawnTool } from "../../../src/tools/pty/tools/spawn";

describe("pty_spawn tool", () => {
  let manager: PTYManager;
  let pty_spawn: ReturnType<typeof createPtySpawnTool>;

  beforeEach(() => {
    manager = new PTYManager();
    pty_spawn = createPtySpawnTool(manager);
  });

  afterEach(() => {
    manager.cleanupAll();
  });

  it("should have correct description", () => {
    expect(pty_spawn.description).toContain("PTY");
    expect(pty_spawn.description).toContain("pseudo-terminal");
  });

  it("should require command parameter", () => {
    expect(pty_spawn.args).toHaveProperty("command");
  });

  it("should have optional args, workdir, env, title parameters", () => {
    expect(pty_spawn.args).toHaveProperty("args");
    expect(pty_spawn.args).toHaveProperty("workdir");
    expect(pty_spawn.args).toHaveProperty("env");
    expect(pty_spawn.args).toHaveProperty("title");
  });

  it("should spawn a PTY and return formatted output", async () => {
    // Use sleep to ensure process is still running when we check status
    const result = await pty_spawn.execute(
      {
        command: "sleep",
        args: ["10"],
        description: "Test sleep command",
      },
      { sessionID: "test-session", messageID: "msg-1" } as any,
    );

    expect(result).toContain("<pty_spawned>");
    expect(result).toContain("</pty_spawned>");
    expect(result).toContain("ID: pty_");
    expect(result).toContain("Command: sleep 10");
    expect(result).toContain("Status: running");
  });
});
