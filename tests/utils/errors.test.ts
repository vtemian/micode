// tests/utils/errors.test.ts
import { describe, expect, it, spyOn } from "bun:test";

describe("errors utility", () => {
  describe("extractErrorMessage", () => {
    it("should extract message from Error instance", async () => {
      const { extractErrorMessage } = await import("../../src/utils/errors");
      const error = new Error("Something went wrong");
      expect(extractErrorMessage(error)).toBe("Something went wrong");
    });

    it("should convert string to message", async () => {
      const { extractErrorMessage } = await import("../../src/utils/errors");
      expect(extractErrorMessage("plain string error")).toBe("plain string error");
    });

    it("should convert number to string", async () => {
      const { extractErrorMessage } = await import("../../src/utils/errors");
      expect(extractErrorMessage(404)).toBe("404");
    });

    it("should handle null", async () => {
      const { extractErrorMessage } = await import("../../src/utils/errors");
      expect(extractErrorMessage(null)).toBe("null");
    });

    it("should handle undefined", async () => {
      const { extractErrorMessage } = await import("../../src/utils/errors");
      expect(extractErrorMessage(undefined)).toBe("undefined");
    });

    it("should handle object with toString", async () => {
      const { extractErrorMessage } = await import("../../src/utils/errors");
      const obj = { toString: () => "custom object" };
      expect(extractErrorMessage(obj)).toBe("custom object");
    });
  });

  describe("formatToolError", () => {
    it("should format error without context", async () => {
      const { formatToolError } = await import("../../src/utils/errors");
      expect(formatToolError("File not found")).toBe("Error: File not found");
    });

    it("should format error with context", async () => {
      const { formatToolError } = await import("../../src/utils/errors");
      expect(formatToolError("File not found", "reading config.json")).toBe(
        "Error (reading config.json): File not found",
      );
    });

    it("should handle empty context", async () => {
      const { formatToolError } = await import("../../src/utils/errors");
      expect(formatToolError("File not found", "")).toBe("Error: File not found");
    });
  });

  describe("catchAndLog", () => {
    it("should return result on success", async () => {
      const { catchAndLog } = await import("../../src/utils/errors");
      const result = catchAndLog("test-module", () => 42);
      expect(result).toBe(42);
    });

    it("should return undefined on error and log", async () => {
      const { catchAndLog } = await import("../../src/utils/errors");
      const consoleSpy = spyOn(console, "error").mockImplementation(() => {});

      const result = catchAndLog("test-module", () => {
        throw new Error("oops");
      });

      expect(result).toBeUndefined();
      expect(consoleSpy).toHaveBeenCalledWith("[test-module] oops");

      consoleSpy.mockRestore();
    });

    it("should handle async functions", async () => {
      const { catchAndLogAsync } = await import("../../src/utils/errors");
      const result = await catchAndLogAsync("test-module", async () => {
        return "async result";
      });
      expect(result).toBe("async result");
    });

    it("should handle async errors", async () => {
      const { catchAndLogAsync } = await import("../../src/utils/errors");
      const consoleSpy = spyOn(console, "error").mockImplementation(() => {});

      const result = await catchAndLogAsync("test-module", async () => {
        throw new Error("async oops");
      });

      expect(result).toBeUndefined();
      expect(consoleSpy).toHaveBeenCalledWith("[test-module] async oops");

      consoleSpy.mockRestore();
    });
  });
});
