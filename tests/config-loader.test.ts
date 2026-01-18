// tests/config-loader.test.ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadMicodeConfig, mergeAgentConfigs } from "../src/config-loader";

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

    // agents: null is not an object, so it falls through to return the raw parsed value
    expect(config).toEqual({ agents: null });
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

    const merged = mergeAgentConfigs(pluginAgents, null);

    expect(merged.commander.model).toBe("anthropic/claude-opus-4-5");
  });
});
