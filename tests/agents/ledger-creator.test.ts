// tests/agents/ledger-creator.test.ts
import { describe, it, expect } from "bun:test";
import { ledgerCreatorAgent } from "../../src/agents/ledger-creator";

describe("ledgerCreatorAgent", () => {
  it("should be configured as a subagent", () => {
    expect(ledgerCreatorAgent.mode).toBe("subagent");
  });

  it("should have description mentioning ledger", () => {
    expect(ledgerCreatorAgent.description.toLowerCase()).toContain("ledger");
  });

  it("should disable edit and task tools", () => {
    expect(ledgerCreatorAgent.tools?.edit).toBe(false);
    expect(ledgerCreatorAgent.tools?.task).toBe(false);
  });
});
