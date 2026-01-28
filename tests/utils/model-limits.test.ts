// tests/utils/model-limits.test.ts
import { describe, expect, it } from "bun:test";

import { DEFAULT_CONTEXT_LIMIT, getContextLimit, MODEL_CONTEXT_LIMITS } from "../../src/utils/model-limits";

describe("model-limits", () => {
  describe("getContextLimit without loaded limits", () => {
    it("should return limit for known model pattern", () => {
      expect(getContextLimit("gpt-4o")).toBe(128_000);
      expect(getContextLimit("claude-opus")).toBe(200_000);
      expect(getContextLimit("gemini-pro")).toBe(1_000_000);
    });

    it("should match case-insensitively", () => {
      expect(getContextLimit("GPT-4O")).toBe(128_000);
      expect(getContextLimit("Claude-Opus")).toBe(200_000);
    });

    it("should return default for unknown model", () => {
      expect(getContextLimit("unknown-model")).toBe(DEFAULT_CONTEXT_LIMIT);
    });
  });

  describe("getContextLimit with loaded limits", () => {
    it("should prefer loaded limits over pattern matching", () => {
      const loadedLimits = new Map([["github-copilot/gpt-4", 128_000]]);

      const limit = getContextLimit("gpt-4", "github-copilot", loadedLimits);

      expect(limit).toBe(128_000);
    });

    it("should use exact match with provider/model", () => {
      const loadedLimits = new Map([
        ["openai/gpt-4o", 150_000], // Different from MODEL_CONTEXT_LIMITS
        ["anthropic/claude-opus", 250_000],
      ]);

      expect(getContextLimit("gpt-4o", "openai", loadedLimits)).toBe(150_000);
      expect(getContextLimit("claude-opus", "anthropic", loadedLimits)).toBe(250_000);
    });

    it("should fall back to pattern matching if not in loaded limits", () => {
      const loadedLimits = new Map([["openai/gpt-4o", 150_000]]);

      // Different provider - should fall back to pattern match
      const limit = getContextLimit("gpt-4o", "azure", loadedLimits);

      expect(limit).toBe(MODEL_CONTEXT_LIMITS["gpt-4o"]);
    });

    it("should fall back to default if no match anywhere", () => {
      const loadedLimits = new Map([["openai/gpt-4o", 150_000]]);

      const limit = getContextLimit("unknown-model", "unknown-provider", loadedLimits);

      expect(limit).toBe(DEFAULT_CONTEXT_LIMIT);
    });

    it("should work without provider ID", () => {
      const loadedLimits = new Map([["openai/gpt-4o", 150_000]]);

      // No provider ID - can't do exact match, falls back to pattern
      const limit = getContextLimit("gpt-4o", undefined, loadedLimits);

      expect(limit).toBe(MODEL_CONTEXT_LIMITS["gpt-4o"]);
    });
  });

  describe("MODEL_CONTEXT_LIMITS", () => {
    it("should have Claude models", () => {
      expect(MODEL_CONTEXT_LIMITS["claude-opus"]).toBe(200_000);
      expect(MODEL_CONTEXT_LIMITS["claude-sonnet"]).toBe(200_000);
    });

    it("should have OpenAI models", () => {
      expect(MODEL_CONTEXT_LIMITS["gpt-4o"]).toBe(128_000);
      expect(MODEL_CONTEXT_LIMITS["gpt-4"]).toBe(128_000);
    });

    it("should have Google models", () => {
      expect(MODEL_CONTEXT_LIMITS["gemini"]).toBe(1_000_000);
    });
  });

  describe("DEFAULT_CONTEXT_LIMIT", () => {
    it("should be 200_000", () => {
      expect(DEFAULT_CONTEXT_LIMIT).toBe(200_000);
    });
  });
});
