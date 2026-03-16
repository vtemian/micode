// tests/setup.ts
import { afterEach, beforeEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
