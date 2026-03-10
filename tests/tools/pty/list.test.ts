// tests/tools/pty/list.test.ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { spawn } from "bun-pty";

import { PTYManager } from "../../../src/tools/pty/manager";
import { createPtyListTool } from "../../../src/tools/pty/tools/list";
import { createPtySpawnTool } from "../../../src/tools/pty/tools/spawn";

describe("pty_list tool", () => {
  let manager: PTYManager;
  let pty_list: ReturnType<typeof createPtyListTool>;
  let pty_spawn: ReturnType<typeof createPtySpawnTool>;

  beforeEach(() => {
    manager = new PTYManager();
    manager.init(spawn);
    pty_list = createPtyListTool(manager);
    pty_spawn = createPtySpawnTool(manager);
  });

  afterEach(() => {
    manager.cleanupAll();
  });

  it("should have correct description", () => {
    expect(pty_list.description).toContain("PTY sessions");
  });

  it("should return empty message when no sessions", async () => {
    const result = await pty_list.execute({}, {} as any);

    expect(result).toContain("<pty_list>");
    expect(result).toContain("No active PTY sessions");
    expect(result).toContain("</pty_list>");
  });

  it("should list all sessions", async () => {
    await pty_spawn.execute({ command: "echo", args: ["1"], title: "First", description: "Test 1" }, {
      sessionID: "test",
      messageID: "msg",
    } as any);
    await pty_spawn.execute({ command: "echo", args: ["2"], title: "Second", description: "Test 2" }, {
      sessionID: "test",
      messageID: "msg",
    } as any);

    const result = await pty_list.execute({}, {} as any);

    expect(result).toContain("<pty_list>");
    expect(result).toContain("First");
    expect(result).toContain("Second");
    expect(result).toContain("Total: 2 session(s)");
    expect(result).toContain("</pty_list>");
  });

  it("should show session details", async () => {
    await pty_spawn.execute({ command: "sleep", args: ["10"], title: "Sleeper", description: "Test" }, {
      sessionID: "test",
      messageID: "msg",
    } as any);

    const result = await pty_list.execute({}, {} as any);

    expect(result).toContain("Command: sleep 10");
    expect(result).toContain("Status: running");
    expect(result).toContain("PID:");
    expect(result).toContain("Lines:");
  });
});
