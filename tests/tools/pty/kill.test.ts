// tests/tools/pty/kill.test.ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { spawn } from "bun-pty";

import { PTYManager } from "../../../src/tools/pty/manager";
import { createPtyKillTool } from "../../../src/tools/pty/tools/kill";
import { createPtySpawnTool } from "../../../src/tools/pty/tools/spawn";

describe("pty_kill tool", () => {
  let manager: PTYManager;
  let pty_kill: ReturnType<typeof createPtyKillTool>;
  let pty_spawn: ReturnType<typeof createPtySpawnTool>;

  beforeEach(() => {
    manager = new PTYManager();
    manager.init(spawn);
    pty_kill = createPtyKillTool(manager);
    pty_spawn = createPtySpawnTool(manager);
  });

  afterEach(() => {
    manager.cleanupAll();
  });

  it("should have correct description", () => {
    expect(pty_kill.description).toContain("Terminates");
    expect(pty_kill.description).toContain("PTY");
  });

  it("should require id parameter", () => {
    expect(pty_kill.args).toHaveProperty("id");
  });

  it("should have optional cleanup parameter", () => {
    expect(pty_kill.args).toHaveProperty("cleanup");
  });

  it("should throw error for unknown session", async () => {
    await expect(pty_kill.execute({ id: "pty_nonexistent" }, {} as any)).rejects.toThrow("not found");
  });

  it("should kill a running session", async () => {
    const spawnResult = await pty_spawn.execute(
      { command: "sleep", args: ["10"], title: "Sleeper", description: "Test" },
      { sessionID: "test", messageID: "msg" } as any,
    );

    const idMatch = spawnResult.match(/ID: (pty_[a-f0-9]+)/);
    const id = idMatch?.[1];
    expect(id).toBeDefined();

    const result = await pty_kill.execute({ id: id! }, {} as any);

    expect(result).toContain("<pty_killed>");
    expect(result).toContain("Killed:");
    expect(result).toContain(id!);
    expect(result).toContain("Sleeper");
    expect(result).toContain("</pty_killed>");
  });

  it("should cleanup session when cleanup=true", async () => {
    const spawnResult = await pty_spawn.execute({ command: "echo", args: ["test"], description: "Test" }, {
      sessionID: "test",
      messageID: "msg",
    } as any);

    const idMatch = spawnResult.match(/ID: (pty_[a-f0-9]+)/);
    const id = idMatch?.[1];

    await pty_kill.execute({ id: id!, cleanup: true }, {} as any);

    const sessions = manager.list();
    expect(sessions).toHaveLength(0);
  });

  it("should retain session when cleanup=false", async () => {
    const spawnResult = await pty_spawn.execute({ command: "echo", args: ["test"], description: "Test" }, {
      sessionID: "test",
      messageID: "msg",
    } as any);

    const idMatch = spawnResult.match(/ID: (pty_[a-f0-9]+)/);
    const id = idMatch?.[1];

    await pty_kill.execute({ id: id!, cleanup: false }, {} as any);

    const sessions = manager.list();
    expect(sessions).toHaveLength(1);
  });
});
