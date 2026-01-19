// tests/agents/mindmodel/convention-extractor.test.ts
import { describe, expect, it } from "bun:test";

import { conventionExtractorAgent } from "../../../src/agents/mindmodel/convention-extractor";

describe("convention-extractor agent", () => {
  it("should be a subagent", () => {
    expect(conventionExtractorAgent.mode).toBe("subagent");
  });

  it("should have read-only tool access", () => {
    expect(conventionExtractorAgent.tools?.write).toBe(false);
    expect(conventionExtractorAgent.tools?.edit).toBe(false);
    expect(conventionExtractorAgent.tools?.bash).toBe(false);
  });

  it("should have prompt that analyzes naming conventions", () => {
    expect(conventionExtractorAgent.prompt).toContain("naming");
    expect(conventionExtractorAgent.prompt).toContain("convention");
  });
});
