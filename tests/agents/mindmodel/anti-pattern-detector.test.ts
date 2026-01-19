// tests/agents/mindmodel/anti-pattern-detector.test.ts
import { describe, expect, it } from "bun:test";

import { antiPatternDetectorAgent } from "../../../src/agents/mindmodel/anti-pattern-detector";

describe("anti-pattern-detector agent", () => {
  it("should be a subagent", () => {
    expect(antiPatternDetectorAgent.mode).toBe("subagent");
  });

  it("should have read-only tool access", () => {
    expect(antiPatternDetectorAgent.tools?.write).toBe(false);
    expect(antiPatternDetectorAgent.tools?.edit).toBe(false);
    expect(antiPatternDetectorAgent.tools?.bash).toBe(false);
  });

  it("should have prompt that finds inconsistencies", () => {
    expect(antiPatternDetectorAgent.prompt).toContain("inconsisten");
    expect(antiPatternDetectorAgent.prompt).toContain("anti-pattern");
  });
});
