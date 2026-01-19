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

  it("should disable bash and task but allow write", () => {
    expect(mindmodelOrchestratorAgent.tools).toEqual({
      bash: false,
      task: false,
    });
  });
});
