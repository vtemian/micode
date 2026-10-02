import { describe, expect, it } from "bun:test";

import { executorAgent } from "../../src/agents/executor";

describe("executor agent", () => {
  it("should use spawn_agent tool for subagents", () => {
    expect(executorAgent.prompt).toContain("spawn_agent");
  });

  it("should delegate implementation and review to subagents", () => {
    expect(executorAgent.prompt).toContain("implementer");
    expect(executorAgent.prompt).toContain("reviewer");
  });

  it("should document the array form, not a flat positional/kwarg call", () => {
    // spawn_agent's schema takes a single "agents" array. Teaching the flat
    // spawn_agent(agent=..., prompt=..., description=...) form makes every
    // implementer/reviewer spawn fail validation, which silently serialises the
    // whole batch down to nothing running. See the array-form regression tests
    // in tests/tools/spawn-agent-contract.test.ts.
    expect(executorAgent.prompt).toContain("spawn_agent({\n  agents: [");
    expect(executorAgent.prompt).not.toMatch(/spawn_agent\(agent="/);
  });

  it("should instruct batching all agents into a single call per phase", () => {
    expect(executorAgent.prompt).toContain("ONE spawn_agent call");
    expect(executorAgent.prompt).toContain("array IS the parallelism");
  });

  it("should have parallel execution documentation", () => {
    expect(executorAgent.prompt).toContain("parallel");
  });
});
