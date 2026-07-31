// tests/utils/process.test.ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

import { findExecutable, runCommand } from "../../src/utils/process";

describe("findExecutable", () => {
  let binDir: string;
  let originalPath: string | undefined;

  beforeEach(() => {
    binDir = mkdtempSync(join(tmpdir(), "process-util-test-"));
    originalPath = process.env.PATH;
  });

  afterEach(() => {
    rmSync(binDir, { recursive: true, force: true });
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
    const second = mkdtempSync(join(tmpdir(), "process-util-second-"));
    const binary = join(second, "later-tool");
    writeFileSync(binary, "#!/bin/sh\nexit 0\n");
    chmodSync(binary, 0o755);
    process.env.PATH = [binDir, second].join(delimiter);

    expect(findExecutable("later-tool")).toBe(binary);
    rmSync(second, { recursive: true, force: true });
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

  it("rejects as soon as the timeout elapses, not when the command would end", async () => {
    const started = Date.now();
    await expect(runCommand("sh", ["-c", "sleep 30"], { timeoutMs: 50 })).rejects.toThrow(/timed out after 50ms/);
    // Guards the regression where a grandchild held the pipes open and the
    // rejection waited for the full sleep.
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("does not apply a timeout when none is given", async () => {
    const result = await runCommand("sh", ["-c", "printf done"]);
    expect(result.stdout).toBe("done");
  });
});
