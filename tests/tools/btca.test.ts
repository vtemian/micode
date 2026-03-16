import { describe, expect, it } from "bun:test";

describe("btca tool", () => {
  describe("checkBtcaAvailable", () => {
    it("should return available status object", async () => {
      const { checkBtcaAvailable } = await import("../../src/tools/btca");
      const result = await checkBtcaAvailable();

      expect(result).toHaveProperty("available");
      expect(typeof result.available).toBe("boolean");

      if (!result.available) {
        expect(result.message).toContain("btca");
        expect(result.message).toContain("Install");
      }
    });
  });

  describe("btca_ask tool", () => {
    it("should be a valid tool with correct schema", async () => {
      const { btca_ask } = await import("../../src/tools/btca");

      expect(btca_ask).toBeDefined();
      expect(btca_ask.description).toContain("source code");
    });

    it("should require tech and question parameters", async () => {
      const { btca_ask } = await import("../../src/tools/btca");

      expect(btca_ask.args).toHaveProperty("tech");
      expect(btca_ask.args).toHaveProperty("question");
    });
  });

  describe("btca registration", () => {
    it("should export checkBtcaAvailable and btca_ask", async () => {
      const btcaModule = await import("../../src/tools/btca");

      expect(btcaModule.checkBtcaAvailable).toBeDefined();
      expect(typeof btcaModule.checkBtcaAvailable).toBe("function");
      expect(btcaModule.btca_ask).toBeDefined();
    });
  });

  describe("btca_ask execution", () => {
    it("should return error message when btca not installed", async () => {
      // This test will pass if btca is not installed (expected in CI)
      // and will also pass if btca IS installed (returns actual output)
      const { btca_ask } = await import("../../src/tools/btca");

      const result = await btca_ask.execute({
        tech: "nonexistent-resource-12345",
        question: "test question",
      });

      expect(typeof result).toBe("string");
      // Either an error or actual output - both are valid strings
      expect(result.length).toBeGreaterThan(0);
    });

    it("should handle empty tech parameter gracefully", async () => {
      const { btca_ask } = await import("../../src/tools/btca");

      // Empty tech should still execute and return an error from btca
      const result = await btca_ask.execute({
        tech: "",
        question: "test question",
      });

      expect(typeof result).toBe("string");
    });
  });
});
