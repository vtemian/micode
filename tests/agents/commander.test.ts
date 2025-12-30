import { describe, it, expect } from "bun:test";
import { primaryAgent } from "../../src/agents/commander";

describe("commander agent", () => {
  it("should not reference handoff agents in prompt", () => {
    expect(primaryAgent.prompt).not.toContain("handoff-creator");
    expect(primaryAgent.prompt).not.toContain("handoff-resumer");
    expect(primaryAgent.prompt).not.toContain('<phase name="handoff">');
  });

  it("should still reference ledger", () => {
    expect(primaryAgent.prompt).toContain("ledger");
  });
});
