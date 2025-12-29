// tests/setup.ts
import { beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// Global test directory for each test
let testDir: string;

export function getTestDir(): string {
  return testDir;
}

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "opencode-test-"));
});

afterEach(() => {
  if (testDir) {
    rmSync(testDir, { recursive: true, force: true });
  }
});
