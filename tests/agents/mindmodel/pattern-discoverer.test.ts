// tests/agents/mindmodel/pattern-discoverer.test.ts
import { describe, expect, it } from "bun:test";

import { mindmodelPatternDiscovererAgent } from "../../../src/agents/mindmodel/pattern-discoverer";

describe("mindmodel pattern-discoverer agent", () => {
  it("should be a subagent", () => {
    expect(mindmodelPatternDiscovererAgent.mode).toBe("subagent");
  });

  it("should have a prompt that discovers pattern categories", () => {
    expect(mindmodelPatternDiscovererAgent.prompt).toContain("categories");
    expect(mindmodelPatternDiscovererAgent.prompt).toContain("components");
    expect(mindmodelPatternDiscovererAgent.prompt).toContain("patterns");
  });

  it("should have read-only tool restrictions", () => {
    expect(mindmodelPatternDiscovererAgent.tools).toEqual({
      write: false,
      edit: false,
      bash: false,
      task: false,
    });
  });
});
