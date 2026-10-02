import { describe, expect, it } from "bun:test";

import { plannerAgent } from "../../src/agents/planner";

describe("planner agent", () => {
  it("should use spawn_agent tool for subagent research", () => {
    expect(plannerAgent.prompt).toContain("spawn_agent tool");
  });

  it("should show spawn_agent calls in the array form", () => {
    // The flat spawn_agent(agent=..., prompt=..., description=...) form fails
    // the tool's schema, so research subagents never spawn. Pin the array form.
    expect(plannerAgent.prompt).toMatch(/spawn_agent\(\{[\s\S]*?agents:\s*\[/);
    expect(plannerAgent.prompt).not.toMatch(/spawn_agent\(agent="/);
  });

  it("should have parallel research documentation", () => {
    expect(plannerAgent.prompt).toContain("parallel");
  });

  it("should enforce synchronous spawn_agent usage", () => {
    expect(plannerAgent.prompt).toContain("synchronously");
  });

  it("should mention running library research in parallel with agents", () => {
    expect(plannerAgent.prompt).toContain("context7");
    expect(plannerAgent.prompt).toContain("btca_ask");
  });
});
