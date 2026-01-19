import { describe, expect, it } from "bun:test";

// Test that all agents are exported from the index
describe("mindmodel agents index", () => {
  it("should export all v2 agents", async () => {
    const index = await import("../../../src/agents/mindmodel");

    // Original agents
    expect(index.exampleExtractorAgent).toBeDefined();
    expect(index.mindmodelOrchestratorAgent).toBeDefined();
    expect(index.mindmodelPatternDiscovererAgent).toBeDefined();
    expect(index.stackDetectorAgent).toBeDefined();

    // New v2 agents
    expect(index.antiPatternDetectorAgent).toBeDefined();
    expect(index.codeClustererAgent).toBeDefined();
    expect(index.constraintReviewerAgent).toBeDefined();
    expect(index.constraintWriterAgent).toBeDefined();
    expect(index.conventionExtractorAgent).toBeDefined();
    expect(index.dependencyMapperAgent).toBeDefined();
    expect(index.domainExtractorAgent).toBeDefined();
  });

  it("should export agents with correct mode", async () => {
    const {
      antiPatternDetectorAgent,
      codeClustererAgent,
      constraintReviewerAgent,
      constraintWriterAgent,
      conventionExtractorAgent,
      dependencyMapperAgent,
      domainExtractorAgent,
    } = await import("../../../src/agents/mindmodel");

    // All new agents should be subagents
    expect(antiPatternDetectorAgent.mode).toBe("subagent");
    expect(codeClustererAgent.mode).toBe("subagent");
    expect(constraintReviewerAgent.mode).toBe("subagent");
    expect(constraintWriterAgent.mode).toBe("subagent");
    expect(conventionExtractorAgent.mode).toBe("subagent");
    expect(dependencyMapperAgent.mode).toBe("subagent");
    expect(domainExtractorAgent.mode).toBe("subagent");
  });
});
