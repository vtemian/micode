// tests/tools/pty/spawn.test.ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { spawn } from "bun-pty";

import { createPTYManager, type PTYManager } from "../../../src/tools/pty/manager";
import { createPtySpawnTool } from "../../../src/tools/pty/tools/spawn";

describe("pty_spawn tool", () => {
  let manager: PTYManager;
  let pty_spawn: ReturnType<typeof createPtySpawnTool>;

  beforeEach(() => {
    manager = createPTYManager();
    manager.init(spawn);
    pty_spawn = createPtySpawnTool(manager, { directory: process.cwd() });
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

  it("defaults the workdir to the workspace and resolves a relative workdir against it", async () => {
    const directory = mkdtempSync(join(tmpdir(), "micode-pty-workspace-"));
    mkdirSync(join(directory, "sub"));
    try {
      const tool = createPtySpawnTool(manager, { directory });
      const ctx = { sessionID: "test-session", progress: () => {} };
      const plain = await tool.execute({ command: "sleep", args: ["10"] }, ctx);
      expect(plain).toContain(`Workdir: ${directory}\n`);
      const nested = await tool.execute({ command: "sleep", args: ["10"], workdir: "sub" }, ctx);
      expect(nested).toContain(`Workdir: ${join(directory, "sub")}\n`);
    } finally {
      manager.cleanupAll();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
