// tests/agents/ledger-creator.test.ts
import { describe, expect, it } from "bun:test";
import { ledgerCreatorAgent } from "../../src/agents/ledger-creator";

describe("ledgerCreatorAgent", () => {
  it("should be configured as a subagent", () => {
    expect(ledgerCreatorAgent.mode).toBe("subagent");
  });

  it("should have description mentioning ledger", () => {
    expect(ledgerCreatorAgent.description?.toLowerCase()).toContain("ledger");
  });

  it("should disable edit and task tools", () => {
    expect(ledgerCreatorAgent.tools?.edit).toBe(false);
    expect(ledgerCreatorAgent.tools?.task).toBe(false);
  });

  it("should support iterative update mode", () => {
    expect(ledgerCreatorAgent.prompt).toContain("previous-ledger");
    expect(ledgerCreatorAgent.prompt).toContain("PRESERVE");
    expect(ledgerCreatorAgent.prompt).toContain("MERGE");
  });

  it("should include file operations section in format", () => {
    expect(ledgerCreatorAgent.prompt).toContain("## File Operations");
    expect(ledgerCreatorAgent.prompt).toContain("### Read");
    expect(ledgerCreatorAgent.prompt).toContain("### Modified");
  });

  it("should have updated ledger format with Progress section", () => {
    expect(ledgerCreatorAgent.prompt).toContain("## Progress");
    expect(ledgerCreatorAgent.prompt).toContain("### Done");
    expect(ledgerCreatorAgent.prompt).toContain("### In Progress");
    expect(ledgerCreatorAgent.prompt).toContain("### Blocked");
  });
});
