import { beforeEach, describe, expect, it } from "bun:test";
import {
  clearFileOps,
  createFileOpsTrackerHook,
  getAndClearFileOps,
  getFileOps,
  trackFileOp,
} from "../../src/hooks/file-ops-tracker";

describe("file-ops-tracker", () => {
  const testSessionID = "test-session-123";

  beforeEach(() => {
    clearFileOps(testSessionID);
  });

  describe("trackFileOp", () => {
    it("should track read operations", () => {
      trackFileOp(testSessionID, "read", "/path/to/file.ts");
      const ops = getFileOps(testSessionID);
      expect(ops.read.has("/path/to/file.ts")).toBe(true);
      expect(ops.modified.size).toBe(0);
    });

    it("should track write operations as modified", () => {
      trackFileOp(testSessionID, "write", "/path/to/file.ts");
      const ops = getFileOps(testSessionID);
      expect(ops.modified.has("/path/to/file.ts")).toBe(true);
      expect(ops.read.size).toBe(0);
    });

    it("should track edit operations as modified", () => {
      trackFileOp(testSessionID, "edit", "/path/to/file.ts");
      const ops = getFileOps(testSessionID);
      expect(ops.modified.has("/path/to/file.ts")).toBe(true);
    });

    it("should deduplicate paths", () => {
      trackFileOp(testSessionID, "read", "/path/to/file.ts");
      trackFileOp(testSessionID, "read", "/path/to/file.ts");
      trackFileOp(testSessionID, "read", "/path/to/file.ts");
      const ops = getFileOps(testSessionID);
      expect(ops.read.size).toBe(1);
    });

    it("should track multiple files", () => {
      trackFileOp(testSessionID, "read", "/path/to/a.ts");
      trackFileOp(testSessionID, "read", "/path/to/b.ts");
      trackFileOp(testSessionID, "write", "/path/to/c.ts");
      const ops = getFileOps(testSessionID);
      expect(ops.read.size).toBe(2);
      expect(ops.modified.size).toBe(1);
    });
  });

  describe("getFileOps", () => {
    it("should return empty sets for unknown session", () => {
      const ops = getFileOps("unknown-session");
      expect(ops.read.size).toBe(0);
      expect(ops.modified.size).toBe(0);
    });
  });

  describe("clearFileOps", () => {
    it("should clear all operations for session", () => {
      trackFileOp(testSessionID, "read", "/path/to/file.ts");
      trackFileOp(testSessionID, "write", "/path/to/other.ts");
      clearFileOps(testSessionID);
      const ops = getFileOps(testSessionID);
      expect(ops.read.size).toBe(0);
      expect(ops.modified.size).toBe(0);
    });
  });

  describe("getAndClearFileOps", () => {
    it("should return ops and clear them", () => {
      trackFileOp(testSessionID, "read", "/path/to/file.ts");
      trackFileOp(testSessionID, "write", "/path/to/other.ts");

      const ops = getAndClearFileOps(testSessionID);
      expect(ops.read.has("/path/to/file.ts")).toBe(true);
      expect(ops.modified.has("/path/to/other.ts")).toBe(true);

      // Should be cleared now
      const opsAfter = getFileOps(testSessionID);
      expect(opsAfter.read.size).toBe(0);
      expect(opsAfter.modified.size).toBe(0);
    });
  });

  describe("createFileOpsTrackerHook", () => {
    it("should export hook creator function", () => {
      expect(typeof createFileOpsTrackerHook).toBe("function");
    });

    it("should return hook with tool.execute.after handler", () => {
      const mockCtx = { directory: "/test" } as any;
      const hook = createFileOpsTrackerHook(mockCtx);
      expect(hook["tool.execute.after"]).toBeDefined();
    });
  });
});
