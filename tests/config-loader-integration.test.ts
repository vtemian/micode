// tests/config-loader-integration.test.ts
import { describe, expect, it } from "bun:test";

import { agents } from "../src/agents";
import { mergeAgentConfigs } from "../src/config-loader";

describe("config-loader integration", () => {
  it("should have all agents defined in agents/index.ts", () => {
    const expectedAgents = [
      "commander",
      "brainstormer",
      "codebase-locator",
      "codebase-analyzer",
      "pattern-finder",
      "planner",
      "implementer",
      "reviewer",
      "executor",
      "ledger-creator",
      "artifact-searcher",
      "mm-orchestrator",
    ];

    for (const agentName of expectedAgents) {
      expect(agents[agentName]).toBeDefined();
    }
  });

  it("should merge user overrides for all agents including mm-orchestrator", () => {
    const userConfig = {
      agents: {
        "mm-orchestrator": { model: "openai/gpt-4o" },
        "ledger-creator": { model: "openai/gpt-4o" },
        "artifact-searcher": { model: "openai/gpt-4o" },
      },
    };

    const availableModels = new Set(["openai/gpt-4o", "openai/gpt-5.2-codex"]);

    const merged = mergeAgentConfigs(agents, userConfig, availableModels);

    // Check mm-orchestrator was merged correctly
    expect(merged["mm-orchestrator"]).toBeDefined();
    expect(merged["mm-orchestrator"].model).toBe("openai/gpt-4o");
    // Original prompt should be preserved
    expect(merged["mm-orchestrator"].prompt).toBeDefined();

    // Check other agents don't have hardcoded model (inherit from OpenCode config)
    expect(merged.commander.model).toBeUndefined();
  });

  it("should preserve all agent properties when merging", () => {
    const userConfig = {
      agents: {
        "mm-orchestrator": { model: "openai/gpt-4o", temperature: 0.5 },
      },
    };

    const availableModels = new Set(["openai/gpt-4o", "openai/gpt-5.2-codex"]);

    const merged = mergeAgentConfigs(agents, userConfig, availableModels);

    const mo = merged["mm-orchestrator"];
    expect(mo.model).toBe("openai/gpt-4o");
    expect(mo.temperature).toBe(0.5);
    expect(mo.mode).toBe("subagent"); // Original
    expect(mo.prompt).toContain("mindmodel"); // Original
  });
});
