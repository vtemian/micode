// tests/hooks/ledger-loader.test.ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("ledger-loader", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `ledger-test-${Date.now()}`);
    mkdirSync(join(testDir, "thoughts", "ledgers"), { recursive: true });
  });

  it("should find ledger files in thoughts/ledgers/", async () => {
    const ledgerPath = join(testDir, "thoughts", "ledgers", "CONTINUITY_test-session.md");
    writeFileSync(ledgerPath, "# Session: test-session\n\n## Goal\nTest goal");

    const { findCurrentLedger } = await import("../../src/hooks/ledger-loader");
    const result = await findCurrentLedger(testDir);

    expect(result).not.toBeNull();
    expect(result?.sessionName).toBe("test-session");
  });

  it("should return null when no ledger exists", async () => {
    const { findCurrentLedger } = await import("../../src/hooks/ledger-loader");
    const result = await findCurrentLedger(testDir);

    expect(result).toBeNull();
  });

  it("returns the requested session's ledger even when another is newer", async () => {
    const { findCurrentLedger } = await import("../../src/hooks/ledger-loader");
    const ledgers = join(testDir, "thoughts", "ledgers");
    writeFileSync(join(ledgers, "CONTINUITY_ses_a.md"), "ledger a");
    writeFileSync(join(ledgers, "CONTINUITY_ses_b.md"), "ledger b");
    utimesSync(join(ledgers, "CONTINUITY_ses_a.md"), new Date(1000), new Date(1000));
    utimesSync(join(ledgers, "CONTINUITY_ses_b.md"), new Date(2000), new Date(2000));

    expect((await findCurrentLedger(testDir, "ses_a"))?.content).toBe("ledger a");
    expect((await findCurrentLedger(testDir))?.content).toBe("ledger b");
    expect((await findCurrentLedger(testDir, "ses_missing"))?.content).toBe("ledger b");
  });

  it("injects the session's own ledger from the chat.params handler", async () => {
    const { createLedgerLoaderHook } = await import("../../src/hooks/ledger-loader");
    const ledgers = join(testDir, "thoughts", "ledgers");
    writeFileSync(join(ledgers, "CONTINUITY_ses_a.md"), "ledger a");
    writeFileSync(join(ledgers, "CONTINUITY_ses_b.md"), "ledger b");
    utimesSync(join(ledgers, "CONTINUITY_ses_a.md"), new Date(1000), new Date(1000));
    utimesSync(join(ledgers, "CONTINUITY_ses_b.md"), new Date(2000), new Date(2000));
    const output: { system?: string } = {};

    await createLedgerLoaderHook({ directory: testDir })["chat.params"]({ sessionID: "ses_a" }, output);

    expect(output.system).toContain("ledger a");
    expect(output.system).not.toContain("ledger b");
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });
});
