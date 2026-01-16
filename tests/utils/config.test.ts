// tests/utils/config.test.ts
import { describe, it, expect } from "bun:test";

describe("config utility", () => {
  describe("config.compaction", () => {
    it("should have threshold", async () => {
      const { config } = await import("../../src/utils/config");
      expect(config.compaction.threshold).toBe(0.5);
    });

    it("should have cooldownMs", async () => {
      const { config } = await import("../../src/utils/config");
      expect(config.compaction.cooldownMs).toBe(30_000);
    });

    it("should have timeoutMs", async () => {
      const { config } = await import("../../src/utils/config");
      expect(config.compaction.timeoutMs).toBe(120_000);
    });
  });

  describe("config.contextWindow", () => {
    it("should have warningThreshold", async () => {
      const { config } = await import("../../src/utils/config");
      expect(config.contextWindow.warningThreshold).toBe(0.7);
    });

    it("should have criticalThreshold", async () => {
      const { config } = await import("../../src/utils/config");
      expect(config.contextWindow.criticalThreshold).toBe(0.85);
    });

    it("should have warningCooldownMs", async () => {
      const { config } = await import("../../src/utils/config");
      expect(config.contextWindow.warningCooldownMs).toBe(120_000);
    });
  });

  describe("config.tokens", () => {
    it("should have charsPerToken", async () => {
      const { config } = await import("../../src/utils/config");
      expect(config.tokens.charsPerToken).toBe(4);
    });

    it("should have defaultContextLimit", async () => {
      const { config } = await import("../../src/utils/config");
      expect(config.tokens.defaultContextLimit).toBe(200_000);
    });

    it("should have defaultMaxOutputTokens", async () => {
      const { config } = await import("../../src/utils/config");
      expect(config.tokens.defaultMaxOutputTokens).toBe(50_000);
    });

    it("should have safetyMargin", async () => {
      const { config } = await import("../../src/utils/config");
      expect(config.tokens.safetyMargin).toBe(0.5);
    });

    it("should have preserveHeaderLines", async () => {
      const { config } = await import("../../src/utils/config");
      expect(config.tokens.preserveHeaderLines).toBe(3);
    });
  });

  describe("config.paths", () => {
    it("should have ledgerDir", async () => {
      const { config } = await import("../../src/utils/config");
      expect(config.paths.ledgerDir).toBe("thoughts/ledgers");
    });

    it("should have ledgerPrefix", async () => {
      const { config } = await import("../../src/utils/config");
      expect(config.paths.ledgerPrefix).toBe("CONTINUITY_");
    });

    it("should have rootContextFiles", async () => {
      const { config } = await import("../../src/utils/config");
      expect(config.paths.rootContextFiles).toEqual(["ARCHITECTURE.md", "CODE_STYLE.md", "README.md"]);
    });

    it("should have dirContextFiles", async () => {
      const { config } = await import("../../src/utils/config");
      expect(config.paths.dirContextFiles).toEqual(["README.md"]);
    });

    it("should have planPattern regex", async () => {
      const { config } = await import("../../src/utils/config");
      expect(config.paths.planPattern.test("thoughts/shared/plans/2026-01-01-test.md")).toBe(true);
      expect(config.paths.planPattern.test("other/path.md")).toBe(false);
    });

    it("should have ledgerPattern regex", async () => {
      const { config } = await import("../../src/utils/config");
      expect(config.paths.ledgerPattern.test("thoughts/ledgers/CONTINUITY_abc123.md")).toBe(true);
      expect(config.paths.ledgerPattern.test("other/path.md")).toBe(false);
    });
  });

  describe("config.timeouts", () => {
    it("should have btcaMs", async () => {
      const { config } = await import("../../src/utils/config");
      expect(config.timeouts.btcaMs).toBe(120_000);
    });

    it("should have toastSuccessMs", async () => {
      const { config } = await import("../../src/utils/config");
      expect(config.timeouts.toastSuccessMs).toBe(3000);
    });

    it("should have toastWarningMs", async () => {
      const { config } = await import("../../src/utils/config");
      expect(config.timeouts.toastWarningMs).toBe(4000);
    });

    it("should have toastErrorMs", async () => {
      const { config } = await import("../../src/utils/config");
      expect(config.timeouts.toastErrorMs).toBe(5000);
    });
  });

  describe("config.limits", () => {
    it("should have largeFileBytes", async () => {
      const { config } = await import("../../src/utils/config");
      expect(config.limits.largeFileBytes).toBe(100 * 1024);
    });

    it("should have maxLinesNoExtract", async () => {
      const { config } = await import("../../src/utils/config");
      expect(config.limits.maxLinesNoExtract).toBe(200);
    });

    it("should have ptyMaxBufferLines", async () => {
      const { config } = await import("../../src/utils/config");
      expect(config.limits.ptyMaxBufferLines).toBe(50_000);
    });

    it("should have ptyDefaultReadLimit", async () => {
      const { config } = await import("../../src/utils/config");
      expect(config.limits.ptyDefaultReadLimit).toBe(500);
    });

    it("should have ptyMaxLineLength", async () => {
      const { config } = await import("../../src/utils/config");
      expect(config.limits.ptyMaxLineLength).toBe(2000);
    });

    it("should have astGrepMaxMatches", async () => {
      const { config } = await import("../../src/utils/config");
      expect(config.limits.astGrepMaxMatches).toBe(100);
    });

    it("should have contextCacheTtlMs", async () => {
      const { config } = await import("../../src/utils/config");
      expect(config.limits.contextCacheTtlMs).toBe(30_000);
    });

    it("should have contextCacheMaxSize", async () => {
      const { config } = await import("../../src/utils/config");
      expect(config.limits.contextCacheMaxSize).toBe(100);
    });
  });
});
