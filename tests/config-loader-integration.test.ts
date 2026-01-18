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
      "project-initializer",
      "ledger-creator",
      "artifact-searcher",
    ];

    for (const agentName of expectedAgents) {
      expect(agents[agentName]).toBeDefined();
      expect(agents[agentName].model).toBeDefined();
    }
  });

  it("should merge user overrides for all agents including project-initializer", () => {
    const userConfig = {
      agents: {
        "project-initializer": { model: "openai/gpt-4o" },
        "ledger-creator": { model: "openai/gpt-4o" },
        "artifact-searcher": { model: "openai/gpt-4o" },
      },
    };

    const availableModels = new Set(["openai/gpt-4o", "openai/gpt-5.2-codex"]);

    const merged = mergeAgentConfigs(agents, userConfig, availableModels);

    // Check project-initializer was merged correctly
    expect(merged["project-initializer"]).toBeDefined();
    expect(merged["project-initializer"].model).toBe("openai/gpt-4o");
    // Original prompt should be preserved
    expect(merged["project-initializer"].prompt).toBeDefined();

    // Check other agents still have defaults
    expect(merged.commander.model).toBe("openai/gpt-5.2-codex");
  });

  it("should preserve all agent properties when merging", () => {
    const userConfig = {
      agents: {
        "project-initializer": { model: "openai/gpt-4o", temperature: 0.5 },
      },
    };

    const availableModels = new Set(["openai/gpt-4o", "openai/gpt-5.2-codex"]);

    const merged = mergeAgentConfigs(agents, userConfig, availableModels);

    const pi = merged["project-initializer"];
    expect(pi.model).toBe("openai/gpt-4o");
    expect(pi.temperature).toBe(0.5);
    expect(pi.mode).toBe("subagent"); // Original
    expect(pi.maxTokens).toBe(32000); // Original
    expect(pi.prompt).toContain("Project Initializer"); // Original
  });
});
