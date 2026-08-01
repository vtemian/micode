// tests/utils/process.test.ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

import { findExecutable, runCommand } from "../../src/utils/process";

// Generous next to the 50ms timeouts under test, but far below the 30s sleeps
// a stalled rejection would wait for.
const SETTLE_BUDGET_MS = 2000;

describe("findExecutable", () => {
  let binDir: string;
  let originalPath: string | undefined;
  let scratchDirs: string[];

  const makeDir = (prefix: string): string => {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    scratchDirs.push(dir);
    return dir;
  };

  beforeEach(() => {
    scratchDirs = [];
    binDir = makeDir("process-util-test-");
    originalPath = process.env.PATH;
  });

  // Cleanup runs here rather than inline, so a failing assertion cannot leak
  // a temp directory.
  afterEach(() => {
    for (const dir of scratchDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    if (originalPath === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = originalPath;
    }
  });

  it("resolves an executable on PATH to its full path", () => {
    const binary = join(binDir, "fake-tool");
    writeFileSync(binary, "#!/bin/sh\nexit 0\n");
    chmodSync(binary, 0o755);
    process.env.PATH = binDir;

    expect(findExecutable("fake-tool")).toBe(binary);
  });

  it("returns null when the name is absent from PATH", () => {
    process.env.PATH = binDir;
    expect(findExecutable("definitely-not-installed")).toBeNull();
  });

  it("ignores a non-executable file of the same name", () => {
    const binary = join(binDir, "not-runnable");
    writeFileSync(binary, "plain text");
    chmodSync(binary, 0o644);
    process.env.PATH = binDir;

    expect(findExecutable("not-runnable")).toBeNull();
  });

  it("searches every PATH entry in order", () => {
    const second = makeDir("process-util-second-");
    const binary = join(second, "later-tool");
    writeFileSync(binary, "#!/bin/sh\nexit 0\n");
    chmodSync(binary, 0o755);
    process.env.PATH = [binDir, second].join(delimiter);

    expect(findExecutable("later-tool")).toBe(binary);
  });

  it("returns null when PATH is unset", () => {
    delete process.env.PATH;
    expect(findExecutable("sh")).toBeNull();
  });
});

describe("runCommand", () => {
  it("collects stdout and a zero exit code", async () => {
    const result = await runCommand("sh", ["-c", "printf hello"]);
    expect(result.stdout).toBe("hello");
    expect(result.exitCode).toBe(0);
  });

  it("collects stderr and a non-zero exit code without throwing", async () => {
    const result = await runCommand("sh", ["-c", "printf oops >&2; exit 3"]);
    expect(result.stderr).toBe("oops");
    expect(result.exitCode).toBe(3);
  });

  it("rejects when the binary cannot be spawned", async () => {
    await expect(runCommand("definitely-not-installed", [])).rejects.toThrow();
  });

  // `sh -c "sleep 30"` is not good enough here: the shell execs into sleep, so
  // there is no grandchild and the pipes close the instant it is signalled.
  // Backgrounding keeps the shell alive with a child holding stdout and stderr,
  // which is the shape that must not stall the rejection.
  it("rejects as soon as the timeout elapses, not when the command would end", async () => {
    const started = Date.now();
    await expect(runCommand("sh", ["-c", "sleep 30 & wait"], { timeoutMs: 50 })).rejects.toThrow(
      /timed out after 50ms/,
    );
    expect(Date.now() - started).toBeLessThan(SETTLE_BUDGET_MS);
  });

  it("reports a signal death as a non-zero exit rather than success", async () => {
    const result = await runCommand("sh", ["-c", "kill -TERM $$"]);
    expect(result.exitCode).not.toBe(0);
    expect(result.signal).toBe("SIGTERM");
  });

  it("does not apply a timeout when none is given", async () => {
    const result = await runCommand("sh", ["-c", "printf done"]);
    expect(result.stdout).toBe("done");
  });
});
