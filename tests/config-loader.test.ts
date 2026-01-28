// tests/config-loader.test.ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadMicodeConfig, loadModelContextLimits, mergeAgentConfigs } from "../src/config-loader";

describe("config-loader", () => {
  let testConfigDir: string;

  beforeEach(() => {
    // Create a test config directory
    testConfigDir = join(tmpdir(), `micode-config-test-${Date.now()}`);
    mkdirSync(testConfigDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testConfigDir, { recursive: true, force: true });
  });

  it("should return null when micode.json does not exist", async () => {
    const config = await loadMicodeConfig(testConfigDir);
    expect(config).toBeNull();
  });

  it("should load agent model overrides from micode.json", async () => {
    const configPath = join(testConfigDir, "micode.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        agents: {
          commander: { model: "openai/gpt-4o" },
          brainstormer: { model: "openai/gpt-4o", temperature: 0.5 },
        },
      }),
    );

    const config = await loadMicodeConfig(testConfigDir);

    expect(config).not.toBeNull();
    expect(config?.agents?.commander?.model).toBe("openai/gpt-4o");
    expect(config?.agents?.brainstormer?.model).toBe("openai/gpt-4o");
    expect(config?.agents?.brainstormer?.temperature).toBe(0.5);
  });

  it("should return null for invalid JSON", async () => {
    const configPath = join(testConfigDir, "micode.json");
    writeFileSync(configPath, "{ invalid json }");

    const config = await loadMicodeConfig(testConfigDir);
    expect(config).toBeNull();
  });

  it("should handle empty agents object", async () => {
    const configPath = join(testConfigDir, "micode.json");
    writeFileSync(configPath, JSON.stringify({ agents: {} }));

    const config = await loadMicodeConfig(testConfigDir);

    expect(config).not.toBeNull();
    expect(config?.agents).toEqual({});
  });

  it("should only allow safe properties (model, temperature, maxTokens)", async () => {
    const configPath = join(testConfigDir, "micode.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        agents: {
          commander: {
            model: "openai/gpt-4o",
            temperature: 0.3,
            maxTokens: 8000,
            prompt: "MALICIOUS PROMPT", // Should be filtered
            tools: { bash: true }, // Should be filtered
          },
        },
      }),
    );

    const config = await loadMicodeConfig(testConfigDir);

    expect(config).not.toBeNull();
    expect(config?.agents?.commander?.model).toBe("openai/gpt-4o");
    expect(config?.agents?.commander?.temperature).toBe(0.3);
    expect(config?.agents?.commander?.maxTokens).toBe(8000);
    // These should be filtered out
    expect((config?.agents?.commander as Record<string, unknown>)?.prompt).toBeUndefined();
    expect((config?.agents?.commander as Record<string, unknown>)?.tools).toBeUndefined();
  });

  it("should handle agents: null", async () => {
    const configPath = join(testConfigDir, "micode.json");
    writeFileSync(configPath, JSON.stringify({ agents: null }));

    const config = await loadMicodeConfig(testConfigDir);

    // agents: null is not a valid object, so it's ignored
    expect(config).toEqual({});
  });

  it("should handle config with no agents key", async () => {
    const configPath = join(testConfigDir, "micode.json");
    writeFileSync(configPath, JSON.stringify({ someOtherKey: "value" }));

    const config = await loadMicodeConfig(testConfigDir);

    expect(config).not.toBeNull();
    expect(config?.agents).toBeUndefined();
  });

  it("should handle non-object agent entries", async () => {
    const configPath = join(testConfigDir, "micode.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        agents: {
          commander: "not-an-object",
          brainstormer: null,
          planner: { model: "openai/gpt-4o" },
        },
      }),
    );

    const config = await loadMicodeConfig(testConfigDir);

    expect(config).not.toBeNull();
    // Non-object entries should be skipped, only valid ones kept
    expect(config?.agents?.commander).toBeUndefined();
    expect(config?.agents?.brainstormer).toBeUndefined();
    expect(config?.agents?.planner?.model).toBe("openai/gpt-4o");
  });
});

describe("mergeAgentConfigs", () => {
  it("should merge user config into plugin agents", () => {
    const pluginAgents = {
      commander: {
        description: "Main agent",
        mode: "primary" as const,
        model: "anthropic/claude-opus-4-5",
        temperature: 0.2,
        prompt: "System prompt",
      },
    };

    const userConfig = {
      agents: {
        commander: { model: "openai/gpt-4o", temperature: 0.5 },
      },
    };
    const availableModels = new Set(["openai/gpt-4o", "anthropic/claude-opus-4-5"]);

    const merged = mergeAgentConfigs(pluginAgents, userConfig, availableModels);

    expect(merged.commander.model).toBe("openai/gpt-4o");
    expect(merged.commander.temperature).toBe(0.5);
    // Original properties should be preserved
    expect(merged.commander.description).toBe("Main agent");
    expect(merged.commander.prompt).toBe("System prompt");
  });

  it("should not modify agents without user overrides", () => {
    const pluginAgents = {
      commander: {
        description: "Main agent",
        model: "anthropic/claude-opus-4-5",
      },
      brainstormer: {
        description: "Design agent",
        model: "anthropic/claude-opus-4-5",
      },
    };

    const userConfig = {
      agents: {
        commander: { model: "openai/gpt-4o" },
      },
    };
    const availableModels = new Set(["openai/gpt-4o", "anthropic/claude-opus-4-5"]);

    const merged = mergeAgentConfigs(pluginAgents, userConfig, availableModels);

    expect(merged.commander.model).toBe("openai/gpt-4o");
    expect(merged.brainstormer.model).toBe("anthropic/claude-opus-4-5");
  });

  it("should handle null user config", () => {
    const pluginAgents = {
      commander: {
        description: "Main agent",
        model: "anthropic/claude-opus-4-5",
      },
    };

    // Pass explicit null for defaultModel to avoid loading from disk
    const merged = mergeAgentConfigs(pluginAgents, null, undefined, null);

    expect(merged.commander.model).toBe("anthropic/claude-opus-4-5");
  });

  it("should apply opencode default model to all agents when no per-agent override", () => {
    const pluginAgents = {
      commander: {
        description: "Main agent",
        model: "openai/gpt-5.2-codex",
      },
      brainstormer: {
        description: "Design agent",
        model: "openai/gpt-5.2-codex",
      },
    };

    const availableModels = new Set(["openai/gpt-5.2-codex", "github-copilot/gpt-5-mini"]);
    const defaultModel = "github-copilot/gpt-5-mini";

    const merged = mergeAgentConfigs(pluginAgents, null, availableModels, defaultModel);

    // Both agents should use the opencode default model
    expect(merged.commander.model).toBe("github-copilot/gpt-5-mini");
    expect(merged.brainstormer.model).toBe("github-copilot/gpt-5-mini");
  });

  it("should prefer per-agent override over opencode default model", () => {
    const pluginAgents = {
      commander: {
        description: "Main agent",
        model: "openai/gpt-5.2-codex",
      },
      brainstormer: {
        description: "Design agent",
        model: "openai/gpt-5.2-codex",
      },
    };

    const userConfig = {
      agents: {
        commander: { model: "openai/gpt-4o" },
      },
    };
    const availableModels = new Set(["openai/gpt-5.2-codex", "github-copilot/gpt-5-mini", "openai/gpt-4o"]);
    const defaultModel = "github-copilot/gpt-5-mini";

    const merged = mergeAgentConfigs(pluginAgents, userConfig, availableModels, defaultModel);

    // Commander has explicit override - should use that
    expect(merged.commander.model).toBe("openai/gpt-4o");
    // Brainstormer has no override - should use opencode default
    expect(merged.brainstormer.model).toBe("github-copilot/gpt-5-mini");
  });

  it("should skip invalid opencode default model", () => {
    const pluginAgents = {
      commander: {
        description: "Main agent",
        model: "openai/gpt-5.2-codex",
      },
    };

    const availableModels = new Set(["openai/gpt-5.2-codex"]);
    const defaultModel = "invalid/nonexistent-model";

    const merged = mergeAgentConfigs(pluginAgents, null, availableModels, defaultModel);

    // Invalid default should be skipped - keep plugin default
    expect(merged.commander.model).toBe("openai/gpt-5.2-codex");
  });
});

describe("loadMicodeConfig - compactionThreshold", () => {
  let testConfigDir: string;

  beforeEach(() => {
    testConfigDir = join(tmpdir(), `micode-config-test-${Date.now()}`);
    mkdirSync(testConfigDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testConfigDir, { recursive: true, force: true });
  });

  it("should load compactionThreshold from micode.json", async () => {
    const configPath = join(testConfigDir, "micode.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        compactionThreshold: 0.3,
      }),
    );

    const config = await loadMicodeConfig(testConfigDir);

    expect(config).not.toBeNull();
    expect(config?.compactionThreshold).toBe(0.3);
  });

  it("should handle compactionThreshold with other config", async () => {
    const configPath = join(testConfigDir, "micode.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        compactionThreshold: 0.4,
        agents: {
          commander: { model: "openai/gpt-4o" },
        },
      }),
    );

    const config = await loadMicodeConfig(testConfigDir);

    expect(config?.compactionThreshold).toBe(0.4);
    expect(config?.agents?.commander?.model).toBe("openai/gpt-4o");
  });

  it("should ignore invalid compactionThreshold values", async () => {
    const configPath = join(testConfigDir, "micode.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        compactionThreshold: "not-a-number",
      }),
    );

    const config = await loadMicodeConfig(testConfigDir);

    expect(config?.compactionThreshold).toBeUndefined();
  });

  it("should ignore compactionThreshold outside valid range (0-1)", async () => {
    const configPath = join(testConfigDir, "micode.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        compactionThreshold: 1.5,
      }),
    );

    const config = await loadMicodeConfig(testConfigDir);

    expect(config?.compactionThreshold).toBeUndefined();
  });

  it("should ignore negative compactionThreshold", async () => {
    const configPath = join(testConfigDir, "micode.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        compactionThreshold: -0.1,
      }),
    );

    const config = await loadMicodeConfig(testConfigDir);

    expect(config?.compactionThreshold).toBeUndefined();
  });
});

describe("loadModelContextLimits", () => {
  let testConfigDir: string;

  beforeEach(() => {
    testConfigDir = join(tmpdir(), `micode-config-test-${Date.now()}`);
    mkdirSync(testConfigDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testConfigDir, { recursive: true, force: true });
  });

  it("should load context limits from opencode.json", () => {
    const configPath = join(testConfigDir, "opencode.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        provider: {
          openai: {
            models: {
              "gpt-4o": {
                limit: { context: 128000, output: 16000 },
              },
            },
          },
          anthropic: {
            models: {
              "claude-opus": {
                limit: { context: 200000, output: 4096 },
              },
            },
          },
        },
      }),
    );

    const limits = loadModelContextLimits(testConfigDir);

    expect(limits.get("openai/gpt-4o")).toBe(128000);
    expect(limits.get("anthropic/claude-opus")).toBe(200000);
  });

  it("should return empty map when opencode.json does not exist", () => {
    const limits = loadModelContextLimits(testConfigDir);

    expect(limits.size).toBe(0);
  });

  it("should skip models without context limit", () => {
    const configPath = join(testConfigDir, "opencode.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        provider: {
          openai: {
            models: {
              "gpt-4o": {
                limit: { context: 128000 },
              },
              "gpt-3.5": {
                // No limit defined
                name: "GPT 3.5",
              },
            },
          },
        },
      }),
    );

    const limits = loadModelContextLimits(testConfigDir);

    expect(limits.get("openai/gpt-4o")).toBe(128000);
    expect(limits.has("openai/gpt-3.5")).toBe(false);
  });

  it("should handle invalid JSON gracefully", () => {
    const configPath = join(testConfigDir, "opencode.json");
    writeFileSync(configPath, "{ invalid json }");

    const limits = loadModelContextLimits(testConfigDir);

    expect(limits.size).toBe(0);
  });

  it("should handle providers without models", () => {
    const configPath = join(testConfigDir, "opencode.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        provider: {
          openai: {
            // No models key
            apiKey: "xxx",
          },
        },
      }),
    );

    const limits = loadModelContextLimits(testConfigDir);

    expect(limits.size).toBe(0);
  });
});

describe("loadMicodeConfig - fragments", () => {
  let testConfigDir: string;

  beforeEach(() => {
    testConfigDir = join(tmpdir(), `micode-config-test-${Date.now()}`);
    mkdirSync(testConfigDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testConfigDir, { recursive: true, force: true });
  });

  it("should load fragments from micode.json", async () => {
    const configPath = join(testConfigDir, "micode.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        fragments: {
          brainstormer: ["Save discussions to multiple files"],
          planner: ["Always include test tasks"],
        },
      }),
    );

    const config = await loadMicodeConfig(testConfigDir);

    expect(config).not.toBeNull();
    expect(config?.fragments?.brainstormer).toEqual(["Save discussions to multiple files"]);
    expect(config?.fragments?.planner).toEqual(["Always include test tasks"]);
  });

  it("should handle empty fragments object", async () => {
    const configPath = join(testConfigDir, "micode.json");
    writeFileSync(configPath, JSON.stringify({ fragments: {} }));

    const config = await loadMicodeConfig(testConfigDir);

    expect(config?.fragments).toEqual({});
  });

  it("should filter out non-string values in fragment arrays", async () => {
    const configPath = join(testConfigDir, "micode.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        fragments: {
          brainstormer: ["valid string", 123, null, "another valid"],
        },
      }),
    );

    const config = await loadMicodeConfig(testConfigDir);

    expect(config?.fragments?.brainstormer).toEqual(["valid string", "another valid"]);
  });

  it("should filter out empty strings from fragments", async () => {
    const configPath = join(testConfigDir, "micode.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        fragments: {
          brainstormer: ["valid", "", "  ", "also valid"],
        },
      }),
    );

    const config = await loadMicodeConfig(testConfigDir);

    expect(config?.fragments?.brainstormer).toEqual(["valid", "also valid"]);
  });

  it("should skip non-array fragment values", async () => {
    const configPath = join(testConfigDir, "micode.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        fragments: {
          brainstormer: ["valid array"],
          planner: "not an array",
          implementer: { not: "array" },
        },
      }),
    );

    const config = await loadMicodeConfig(testConfigDir);

    expect(config?.fragments?.brainstormer).toEqual(["valid array"]);
    expect(config?.fragments?.planner).toBeUndefined();
    expect(config?.fragments?.implementer).toBeUndefined();
  });
});
