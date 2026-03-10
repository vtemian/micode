// tests/config-loader.test.ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  loadAvailableModels,
  loadDefaultModel,
  loadMicodeConfig,
  loadModelContextLimits,
  mergeAgentConfigs,
} from "../src/config-loader";
import { DEFAULT_MODEL } from "../src/utils/config";

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
    writeFileSync(configPath, "not json at all }{][");

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
        model: DEFAULT_MODEL,
      },
      brainstormer: {
        description: "Design agent",
        model: DEFAULT_MODEL,
      },
    };

    const availableModels = new Set([DEFAULT_MODEL, "github-copilot/gpt-5-mini"]);
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
        model: DEFAULT_MODEL,
      },
      brainstormer: {
        description: "Design agent",
        model: DEFAULT_MODEL,
      },
    };

    const userConfig = {
      agents: {
        commander: { model: "openai/gpt-4o" },
      },
    };
    const availableModels = new Set([DEFAULT_MODEL, "github-copilot/gpt-5-mini", "openai/gpt-4o"]);
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
        model: DEFAULT_MODEL,
      },
    };

    const availableModels = new Set([DEFAULT_MODEL]);
    const defaultModel = "invalid/nonexistent-model";

    const merged = mergeAgentConfigs(pluginAgents, null, availableModels, defaultModel);

    // Invalid default should be skipped - keep plugin default
    expect(merged.commander.model).toBe(DEFAULT_MODEL);
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

describe("JSONC parsing support", () => {
  let testConfigDir: string;

  beforeEach(() => {
    testConfigDir = join(tmpdir(), `micode-jsonc-test-${Date.now()}`);
    mkdirSync(testConfigDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testConfigDir, { recursive: true, force: true });
  });

  describe("loadMicodeConfig with JSONC", () => {
    it("should parse micode.jsonc with line comments", async () => {
      const configPath = join(testConfigDir, "micode.jsonc");
      writeFileSync(
        configPath,
        `{
  // This is a line comment
  "agents": {
    "commander": { "model": "openai/gpt-4o" } // inline comment
  }
}`,
      );

      const config = await loadMicodeConfig(testConfigDir);

      expect(config).not.toBeNull();
      expect(config?.agents?.commander?.model).toBe("openai/gpt-4o");
    });

    it("should parse micode.jsonc with block comments", async () => {
      const configPath = join(testConfigDir, "micode.jsonc");
      writeFileSync(
        configPath,
        `{
  /* Block comment explaining config */
  "agents": {
    "brainstormer": {
      /* Use a creative model */
      "model": "openai/gpt-4o",
      "temperature": 0.8
    }
  }
}`,
      );

      const config = await loadMicodeConfig(testConfigDir);

      expect(config).not.toBeNull();
      expect(config?.agents?.brainstormer?.model).toBe("openai/gpt-4o");
      expect(config?.agents?.brainstormer?.temperature).toBe(0.8);
    });

    it("should parse micode.jsonc with trailing commas", async () => {
      const configPath = join(testConfigDir, "micode.jsonc");
      writeFileSync(
        configPath,
        `{
  "agents": {
    "commander": {
      "model": "openai/gpt-4o",
      "temperature": 0.3,
    },
  },
  "compactionThreshold": 0.5,
}`,
      );

      const config = await loadMicodeConfig(testConfigDir);

      expect(config).not.toBeNull();
      expect(config?.agents?.commander?.model).toBe("openai/gpt-4o");
      expect(config?.agents?.commander?.temperature).toBe(0.3);
      expect(config?.compactionThreshold).toBe(0.5);
    });

    it("should prefer micode.jsonc over micode.json when both exist", async () => {
      // Write .json with one value
      writeFileSync(
        join(testConfigDir, "micode.json"),
        JSON.stringify({
          agents: { commander: { model: "openai/gpt-3.5" } },
        }),
      );
      // Write .jsonc with a different value
      writeFileSync(
        join(testConfigDir, "micode.jsonc"),
        `{
  "agents": {
    "commander": { "model": "openai/gpt-4o" }
  }
}`,
      );

      const config = await loadMicodeConfig(testConfigDir);

      expect(config).not.toBeNull();
      // Should use the .jsonc value, not the .json value
      expect(config?.agents?.commander?.model).toBe("openai/gpt-4o");
    });

    it("should fall back to micode.json when micode.jsonc does not exist", async () => {
      writeFileSync(
        join(testConfigDir, "micode.json"),
        JSON.stringify({
          agents: { commander: { model: "openai/gpt-4o" } },
        }),
      );

      const config = await loadMicodeConfig(testConfigDir);

      expect(config).not.toBeNull();
      expect(config?.agents?.commander?.model).toBe("openai/gpt-4o");
    });

    it("should return null when neither micode.jsonc nor micode.json exists", async () => {
      const config = await loadMicodeConfig(testConfigDir);
      expect(config).toBeNull();
    });

    it("should parse micode.jsonc with all comment types combined", async () => {
      const configPath = join(testConfigDir, "micode.jsonc");
      writeFileSync(
        configPath,
        `{
  // Line comment
  /* Block comment */
  "agents": {
    "commander": {
      "model": "openai/gpt-4o", // trailing comma + inline comment
      "temperature": 0.3,
    },
  },
  "features": {
    "mindmodelInjection": true, // enable mindmodel
  },
  "compactionThreshold": 0.4,
}`,
      );

      const config = await loadMicodeConfig(testConfigDir);

      expect(config).not.toBeNull();
      expect(config?.agents?.commander?.model).toBe("openai/gpt-4o");
      expect(config?.agents?.commander?.temperature).toBe(0.3);
      expect(config?.features?.mindmodelInjection).toBe(true);
      expect(config?.compactionThreshold).toBe(0.4);
    });
  });

  describe("loadModelContextLimits with JSONC", () => {
    it("should parse opencode.jsonc with comments for context limits", () => {
      const configPath = join(testConfigDir, "opencode.jsonc");
      writeFileSync(
        configPath,
        `{
  // Provider configuration
  "provider": {
    "openai": {
      "models": {
        "gpt-4o": {
          "limit": { "context": 128000 } // 128k context window
        }
      }
    }
  }
}`,
      );

      const limits = loadModelContextLimits(testConfigDir);

      expect(limits.get("openai/gpt-4o")).toBe(128000);
    });

    it("should parse opencode.jsonc with trailing commas for context limits", () => {
      const configPath = join(testConfigDir, "opencode.jsonc");
      writeFileSync(
        configPath,
        `{
  "provider": {
    "openai": {
      "models": {
        "gpt-4o": {
          "limit": { "context": 128000, },
        },
      },
    },
  },
}`,
      );

      const limits = loadModelContextLimits(testConfigDir);

      expect(limits.get("openai/gpt-4o")).toBe(128000);
    });

    it("should prefer opencode.jsonc over opencode.json for context limits", () => {
      // .json has 64000
      writeFileSync(
        join(testConfigDir, "opencode.json"),
        JSON.stringify({
          provider: {
            openai: { models: { "gpt-4o": { limit: { context: 64000 } } } },
          },
        }),
      );
      // .jsonc has 128000
      writeFileSync(
        join(testConfigDir, "opencode.jsonc"),
        `{
  "provider": {
    "openai": {
      "models": {
        "gpt-4o": { "limit": { "context": 128000 } }
      }
    }
  }
}`,
      );

      const limits = loadModelContextLimits(testConfigDir);

      // Should use .jsonc value
      expect(limits.get("openai/gpt-4o")).toBe(128000);
    });

    it("should fall back to opencode.json for context limits when .jsonc missing", () => {
      writeFileSync(
        join(testConfigDir, "opencode.json"),
        JSON.stringify({
          provider: {
            openai: { models: { "gpt-4o": { limit: { context: 128000 } } } },
          },
        }),
      );

      const limits = loadModelContextLimits(testConfigDir);

      expect(limits.get("openai/gpt-4o")).toBe(128000);
    });

    it("should return empty map when neither opencode.jsonc nor opencode.json exists", () => {
      const limits = loadModelContextLimits(testConfigDir);

      expect(limits.size).toBe(0);
    });
  });

  describe("loadAvailableModels with JSONC", () => {
    it("should load models from opencode.jsonc", () => {
      const configPath = join(testConfigDir, "opencode.jsonc");
      writeFileSync(
        configPath,
        `{
  // Model configuration
  "provider": {
    "openai": {
      "models": {
        "gpt-4o": {}, // latest model
      },
    },
  },
}`,
      );

      const models = loadAvailableModels(testConfigDir);

      expect(models.has("openai/gpt-4o")).toBe(true);
    });

    it("should prefer opencode.jsonc over opencode.json for available models", () => {
      writeFileSync(
        join(testConfigDir, "opencode.json"),
        JSON.stringify({
          provider: { openai: { models: { "gpt-3.5": {} } } },
        }),
      );
      writeFileSync(
        join(testConfigDir, "opencode.jsonc"),
        `{
  "provider": {
    "openai": {
      "models": { "gpt-4o": {} }
    }
  }
}`,
      );

      const models = loadAvailableModels(testConfigDir);

      // Should have model from .jsonc, not .json
      expect(models.has("openai/gpt-4o")).toBe(true);
      expect(models.has("openai/gpt-3.5")).toBe(false);
    });
  });

  describe("loadDefaultModel with JSONC", () => {
    it("should load default model from opencode.jsonc", () => {
      const configPath = join(testConfigDir, "opencode.jsonc");
      writeFileSync(
        configPath,
        `{
  // Use GPT-4o as default
  "model": "openai/gpt-4o",
}`,
      );

      const model = loadDefaultModel(testConfigDir);

      expect(model).toBe("openai/gpt-4o");
    });
  });
});
