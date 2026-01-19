// tests/agents/mindmodel/domain-extractor.test.ts
import { describe, expect, it } from "bun:test";

import { domainExtractorAgent } from "../../../src/agents/mindmodel/domain-extractor";

describe("domain-extractor agent", () => {
  it("should be a subagent", () => {
    expect(domainExtractorAgent.mode).toBe("subagent");
  });

  it("should have read-only tool access", () => {
    expect(domainExtractorAgent.tools?.write).toBe(false);
    expect(domainExtractorAgent.tools?.edit).toBe(false);
    expect(domainExtractorAgent.tools?.bash).toBe(false);
  });

  it("should have prompt that extracts business terminology", () => {
    expect(domainExtractorAgent.prompt).toContain("domain");
    expect(domainExtractorAgent.prompt).toContain("terminology");
  });
});
