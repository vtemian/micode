// tests/utils/logger.test.ts
import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";

describe("logger utility", () => {
  let consoleLogSpy: ReturnType<typeof spyOn>;
  let consoleWarnSpy: ReturnType<typeof spyOn>;
  let consoleErrorSpy: ReturnType<typeof spyOn>;
  let originalDebug: string | undefined;

  beforeEach(() => {
    consoleLogSpy = spyOn(console, "log").mockImplementation(() => {});
    consoleWarnSpy = spyOn(console, "warn").mockImplementation(() => {});
    consoleErrorSpy = spyOn(console, "error").mockImplementation(() => {});
    originalDebug = process.env.DEBUG;
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    if (originalDebug !== undefined) {
      process.env.DEBUG = originalDebug;
    } else {
      delete process.env.DEBUG;
    }
  });

  describe("log.info", () => {
    it("should log with module prefix", async () => {
      const { log } = await import("../../src/utils/logger");
      log.info("my-module", "Hello world");
      expect(consoleLogSpy).toHaveBeenCalledWith("[my-module] Hello world");
    });
  });

  describe("log.warn", () => {
    it("should warn with module prefix", async () => {
      const { log } = await import("../../src/utils/logger");
      log.warn("my-module", "Something fishy");
      expect(consoleWarnSpy).toHaveBeenCalledWith("[my-module] Something fishy");
    });
  });

  describe("log.error", () => {
    it("should error with module prefix", async () => {
      const { log } = await import("../../src/utils/logger");
      log.error("my-module", "Something broke");
      expect(consoleErrorSpy).toHaveBeenCalledWith("[my-module] Something broke");
    });

    it("should include error object when provided", async () => {
      const { log } = await import("../../src/utils/logger");
      const err = new Error("details");
      log.error("my-module", "Something broke", err);
      expect(consoleErrorSpy).toHaveBeenCalledWith("[my-module] Something broke", err);
    });
  });

  describe("log.debug", () => {
    it("should not log when DEBUG is not set", async () => {
      delete process.env.DEBUG;
      // Re-import to pick up env change
      const { log } = await import("../../src/utils/logger");
      log.debug("my-module", "Debug info");
      expect(consoleLogSpy).not.toHaveBeenCalled();
    });

    it("should log when DEBUG is set", async () => {
      process.env.DEBUG = "1";
      // Need fresh import to pick up env change
      const moduleUrl = new URL("../../src/utils/logger", import.meta.url);
      moduleUrl.searchParams.set("t", Date.now().toString());
      const { log } = await import(moduleUrl.href);
      log.debug("my-module", "Debug info");
      expect(consoleLogSpy).toHaveBeenCalledWith("[my-module] Debug info");
    });
  });
});
