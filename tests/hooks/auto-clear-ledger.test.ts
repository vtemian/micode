// tests/hooks/auto-clear-ledger.test.ts
import { describe, it, expect } from "bun:test";

describe("auto-clear-ledger", () => {
  it("should export createAutoClearLedgerHook function", async () => {
    const module = await import("../../src/hooks/auto-clear-ledger");
    expect(typeof module.createAutoClearLedgerHook).toBe("function");
  });

  it("should use 80% threshold", async () => {
    const { DEFAULT_THRESHOLD } = await import("../../src/hooks/auto-clear-ledger");
    expect(DEFAULT_THRESHOLD).toBe(0.8);
  });

  it("should have 60 second cooldown", async () => {
    const { CLEAR_COOLDOWN_MS } = await import("../../src/hooks/auto-clear-ledger");
    expect(CLEAR_COOLDOWN_MS).toBe(60_000);
  });

  it("should not reference handoff-creator in source", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/hooks/auto-clear-ledger.ts", "utf-8");
    expect(source).not.toContain("handoff-creator");
    expect(source).not.toContain("handoffSessionID");
    expect(source).not.toContain("handoff");
  });
});
