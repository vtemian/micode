// tests/agents/mindmodel/orchestrator.test.ts
import { describe, expect, it } from "bun:test";

import { mindmodelOrchestratorAgent } from "../../../src/agents/mindmodel/orchestrator";

describe("mindmodel-orchestrator agent", () => {
  it("should be a subagent", () => {
    expect(mindmodelOrchestratorAgent.mode).toBe("subagent");
  });

  it("should reference spawn_agent for parallel execution", () => {
    expect(mindmodelOrchestratorAgent.prompt).toContain("spawn_agent");
    expect(mindmodelOrchestratorAgent.prompt).toContain("parallel");
  });

  it("should reference all mindmodel subagents", () => {
    expect(mindmodelOrchestratorAgent.prompt).toContain("stack-detector");
    expect(mindmodelOrchestratorAgent.prompt).toContain("pattern-discoverer");
    expect(mindmodelOrchestratorAgent.prompt).toContain("example-extractor");
  });

  it("should disable bash but allow write and other tools", () => {
    expect(mindmodelOrchestratorAgent.tools).toEqual({
      bash: false,
    });
  });

  it("should reference all v2 phase agents", () => {
    const prompt = mindmodelOrchestratorAgent.prompt;
    // Phase 1
    expect(prompt).toContain("mm-stack-detector");
    expect(prompt).toContain("mm-dependency-mapper");
    expect(prompt).toContain("mm-convention-extractor");
    expect(prompt).toContain("mm-domain-extractor");
    // Phase 2
    expect(prompt).toContain("mm-code-clusterer");
    expect(prompt).toContain("mm-pattern-discoverer");
    expect(prompt).toContain("mm-anti-pattern-detector");
    // Phase 3
    expect(prompt).toContain("mm-example-extractor");
    // Phase 4
    expect(prompt).toContain("mm-constraint-writer");
  });
});
