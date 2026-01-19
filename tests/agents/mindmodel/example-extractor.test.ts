// tests/agents/mindmodel/example-extractor.test.ts
import { describe, expect, it } from "bun:test";

import { exampleExtractorAgent } from "../../../src/agents/mindmodel/example-extractor";

describe("example-extractor agent", () => {
  it("should be a subagent", () => {
    expect(exampleExtractorAgent.mode).toBe("subagent");
  });

  it("should have a prompt that extracts code examples", () => {
    expect(exampleExtractorAgent.prompt).toContain("extract");
    expect(exampleExtractorAgent.prompt).toContain("example");
    expect(exampleExtractorAgent.prompt).toContain("representative");
  });

  it("should have read-only tool restrictions", () => {
    expect(exampleExtractorAgent.tools).toEqual({
      write: false,
      edit: false,
      bash: false,
      task: false,
    });
  });
});
