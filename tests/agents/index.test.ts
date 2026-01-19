import { describe, expect, it } from "bun:test";

describe("agents index", () => {
  it("should not export handoff agents", async () => {
    const module = await import("../../src/agents/index");

    expect(module.agents["handoff-creator"]).toBeUndefined();
    expect(module.agents["handoff-resumer"]).toBeUndefined();
    expect((module as Record<string, unknown>).handoffCreatorAgent).toBeUndefined();
    expect((module as Record<string, unknown>).handoffResumerAgent).toBeUndefined();
  });

  it("should still export other agents", async () => {
    const module = await import("../../src/agents/index");

    expect(module.agents["ledger-creator"]).toBeDefined();
    expect(module.agents["brainstormer"]).toBeDefined();
    expect(module.agents["commander"]).toBeDefined();
  });

  it("should register mindmodel v2 analysis agents", async () => {
    const module = await import("../../src/agents/index");

    // New v2 analysis agents
    expect(module.agents["mm-dependency-mapper"]).toBeDefined();
    expect(module.agents["mm-convention-extractor"]).toBeDefined();
    expect(module.agents["mm-domain-extractor"]).toBeDefined();
    expect(module.agents["mm-code-clusterer"]).toBeDefined();
    expect(module.agents["mm-anti-pattern-detector"]).toBeDefined();
    expect(module.agents["mm-constraint-writer"]).toBeDefined();
    expect(module.agents["mm-constraint-reviewer"]).toBeDefined();
  });

  it("should configure mindmodel v2 agents as subagents", async () => {
    const module = await import("../../src/agents/index");

    const v2Agents = [
      "mm-dependency-mapper",
      "mm-convention-extractor",
      "mm-domain-extractor",
      "mm-code-clusterer",
      "mm-anti-pattern-detector",
      "mm-constraint-writer",
      "mm-constraint-reviewer",
    ];

    for (const agentName of v2Agents) {
      const agent = module.agents[agentName];
      expect(agent.mode).toBe("subagent");
      expect(agent.model).toBe("openai/gpt-5.2-codex");
    }
  });
});
