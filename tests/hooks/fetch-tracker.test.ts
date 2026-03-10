import { beforeEach, describe, expect, it } from "bun:test";

import {
  clearSession,
  createFetchTrackerHook,
  FETCH_TOOLS,
  getCacheEntry,
  getCallCount,
  normalizeKey,
} from "../../src/hooks/fetch-tracker";

describe("fetch-tracker", () => {
  const testSessionID = "test-session-456";

  beforeEach(() => {
    clearSession(testSessionID);
  });

  describe("FETCH_TOOLS", () => {
    it("should include all tracked tool names", () => {
      expect(FETCH_TOOLS).toContain("webfetch");
      expect(FETCH_TOOLS).toContain("context7_query-docs");
      expect(FETCH_TOOLS).toContain("context7_resolve-library-id");
      expect(FETCH_TOOLS).toContain("btca_ask");
    });
  });

  describe("normalizeKey", () => {
    it("should normalize webfetch URLs via URL constructor", () => {
      const key = normalizeKey("webfetch", { url: "HTTPS://Example.COM/Page" });
      // URL constructor lowercases protocol and host, preserves path case
      expect(key).toBe("webfetch|https://example.com/Page");
    });

    it("should sort query params for webfetch URLs", () => {
      const key1 = normalizeKey("webfetch", { url: "https://example.com?b=2&a=1" });
      const key2 = normalizeKey("webfetch", { url: "https://example.com?a=1&b=2" });
      expect(key1).toBe(key2);
    });

    it("should handle webfetch URLs without query params", () => {
      const key = normalizeKey("webfetch", { url: "https://example.com/path" });
      expect(key).toBe("webfetch|https://example.com/path");
    });

    it("should normalize context7_query-docs", () => {
      const key = normalizeKey("context7_query-docs", {
        libraryId: "/vercel/next.js",
        query: "how to use app router",
      });
      expect(key).toBe("context7_query-docs|/vercel/next.js|how to use app router");
    });

    it("should normalize context7_resolve-library-id", () => {
      const key = normalizeKey("context7_resolve-library-id", {
        libraryName: "next.js",
        query: "routing",
      });
      expect(key).toBe("context7_resolve-library-id|next.js|routing");
    });

    it("should normalize btca_ask", () => {
      const key = normalizeKey("btca_ask", {
        tech: "react",
        question: "how does useState work",
      });
      expect(key).toBe("btca_ask|react|how does useState work");
    });

    it("should return null for unknown tools", () => {
      const key = normalizeKey("read", { filePath: "/some/file" });
      expect(key).toBeNull();
    });

    it("should return null for missing args", () => {
      const key = normalizeKey("webfetch", {});
      expect(key).toBeNull();
    });

    it("should return null for undefined args", () => {
      const key = normalizeKey("webfetch", undefined);
      expect(key).toBeNull();
    });

    it("should handle malformed URLs gracefully", () => {
      const key = normalizeKey("webfetch", { url: "not a valid url" });
      // Falls back to raw string when URL parsing fails
      expect(key).toBe("webfetch|not a valid url");
    });
  });

  describe("createFetchTrackerHook", () => {
    it("should export hook creator function", () => {
      expect(typeof createFetchTrackerHook).toBe("function");
    });

    it("should return hook with after handler, event handler, and cleanupSession", () => {
      const mockCtx = { directory: "/test" } as any;
      const hook = createFetchTrackerHook(mockCtx);
      expect(hook["tool.execute.after"]).toBeDefined();
      expect(hook.event).toBeDefined();
      expect(hook.cleanupSession).toBeDefined();
    });
  });

  describe("call counting", () => {
    it("should start at 0 for unknown session/key", () => {
      expect(getCallCount("unknown-session", "webfetch|https://example.com")).toBe(0);
    });

    it("should increment count via after hook", async () => {
      const mockCtx = { directory: "/test" } as any;
      const hook = createFetchTrackerHook(mockCtx);

      const output = { output: "some content" };
      await hook["tool.execute.after"](
        { tool: "webfetch", sessionID: testSessionID, args: { url: "https://example.com" } },
        output,
      );

      expect(getCallCount(testSessionID, "webfetch|https://example.com/")).toBe(1);
    });

    it("should not count non-fetch tools", async () => {
      const mockCtx = { directory: "/test" } as any;
      const hook = createFetchTrackerHook(mockCtx);

      const output = { output: "file content" };
      await hook["tool.execute.after"](
        { tool: "read", sessionID: testSessionID, args: { filePath: "/some/file" } },
        output,
      );

      // No call count should exist
      expect(getCallCount(testSessionID, "read|/some/file")).toBe(0);
    });
  });

  describe("caching and output replacement", () => {
    it("should cache results after first fetch", async () => {
      const mockCtx = { directory: "/test" } as any;
      const hook = createFetchTrackerHook(mockCtx);

      const args = { url: "https://example.com/cached" };

      // First call — after hook stores in cache
      const output1 = { output: "cached content here" };
      await hook["tool.execute.after"]({ tool: "webfetch", sessionID: testSessionID, args }, output1);

      // Verify cache entry exists
      const cached = getCacheEntry(testSessionID, "webfetch|https://example.com/cached");
      expect(cached).toBeDefined();
      expect(cached!.content).toBe("cached content here");
    });

    it("should replace output with cached content on second call", async () => {
      const mockCtx = { directory: "/test" } as any;
      const hook = createFetchTrackerHook(mockCtx);

      const args = { url: "https://example.com/hit" };

      // First call — store in cache
      await hook["tool.execute.after"](
        { tool: "webfetch", sessionID: testSessionID, args },
        { output: "original content" },
      );

      // Second call — after hook should replace output with cached content
      const output2 = { output: "new fetch result that should be replaced" };
      await hook["tool.execute.after"]({ tool: "webfetch", sessionID: testSessionID, args }, output2);

      expect(output2.output).toContain("original content");
      expect(output2.output).toContain("<from-cache>");
      expect(output2.output).not.toContain("new fetch result");
    });

    it("should not cache results for non-fetch tools", async () => {
      const mockCtx = { directory: "/test" } as any;
      const hook = createFetchTrackerHook(mockCtx);

      await hook["tool.execute.after"](
        { tool: "read", sessionID: testSessionID, args: { filePath: "/file" } },
        { output: "file content" },
      );

      const cached = getCacheEntry(testSessionID, "read|/file");
      expect(cached).toBeUndefined();
    });
  });

  describe("warning injection", () => {
    it("should inject warning after warnThreshold calls", async () => {
      const mockCtx = { directory: "/test" } as any;
      const hook = createFetchTrackerHook(mockCtx);

      const args = { url: "https://example.com/page" };

      // Simulate 3 calls (warnThreshold)
      for (let i = 0; i < 3; i++) {
        await hook["tool.execute.after"](
          { tool: "webfetch", sessionID: testSessionID, args },
          { output: `content-${i}` },
        );
      }

      // Count is now 3 (at warnThreshold). 4th call should have warning.
      const output4 = { output: "fresh content" };
      await hook["tool.execute.after"]({ tool: "webfetch", sessionID: testSessionID, args }, output4);

      // Should contain cached content from first call + warning
      expect(output4.output).toContain("<from-cache>");
      expect(output4.output).toContain("<fetch-warning>");
      expect(output4.output).not.toContain("fresh content");
    });
  });

  describe("blocking", () => {
    it("should block after maxCallsPerResource calls", async () => {
      const mockCtx = { directory: "/test" } as any;
      const hook = createFetchTrackerHook(mockCtx);

      const args = { url: "https://example.com/blocked" };

      // Simulate 5 calls (maxCallsPerResource)
      for (let i = 0; i < 5; i++) {
        await hook["tool.execute.after"](
          { tool: "webfetch", sessionID: testSessionID, args },
          { output: `content-${i}` },
        );
      }

      // 6th call — should be blocked
      const output6 = { output: "should be replaced" };
      await hook["tool.execute.after"]({ tool: "webfetch", sessionID: testSessionID, args }, output6);

      expect(output6.output).toContain("<fetch-blocked>");
      expect(output6.output).not.toContain("should be replaced");
      expect(output6.output).not.toContain("content-"); // No cached content, just block message
    });
  });

  describe("session isolation", () => {
    it("should track calls independently per session", async () => {
      const mockCtx = { directory: "/test" } as any;
      const hook = createFetchTrackerHook(mockCtx);

      const args = { url: "https://example.com" };
      const session1 = "session-1";
      const session2 = "session-2";

      await hook["tool.execute.after"]({ tool: "webfetch", sessionID: session1, args }, { output: "content" });
      await hook["tool.execute.after"]({ tool: "webfetch", sessionID: session1, args }, { output: "content" });

      expect(getCallCount(session1, "webfetch|https://example.com/")).toBe(2);
      expect(getCallCount(session2, "webfetch|https://example.com/")).toBe(0);

      // Cleanup
      clearSession(session1);
      clearSession(session2);
    });
  });

  describe("session cleanup", () => {
    it("should clear call counts and cache on cleanup", async () => {
      const mockCtx = { directory: "/test" } as any;
      const hook = createFetchTrackerHook(mockCtx);

      const args = { url: "https://example.com/cleanup" };

      await hook["tool.execute.after"]({ tool: "webfetch", sessionID: testSessionID, args }, { output: "content" });

      expect(getCallCount(testSessionID, "webfetch|https://example.com/cleanup")).toBe(1);
      expect(getCacheEntry(testSessionID, "webfetch|https://example.com/cleanup")).toBeDefined();

      clearSession(testSessionID);

      expect(getCallCount(testSessionID, "webfetch|https://example.com/cleanup")).toBe(0);
      expect(getCacheEntry(testSessionID, "webfetch|https://example.com/cleanup")).toBeUndefined();
    });

    it("should clean up via event handler on session.deleted", async () => {
      const mockCtx = { directory: "/test" } as any;
      const hook = createFetchTrackerHook(mockCtx);

      const args = { url: "https://example.com/event-cleanup" };

      await hook["tool.execute.after"]({ tool: "webfetch", sessionID: testSessionID, args }, { output: "content" });

      expect(getCallCount(testSessionID, "webfetch|https://example.com/event-cleanup")).toBe(1);

      // Simulate session.deleted event
      await hook.event({
        event: {
          type: "session.deleted",
          properties: { info: { id: testSessionID } },
        },
      });

      expect(getCallCount(testSessionID, "webfetch|https://example.com/event-cleanup")).toBe(0);
    });
  });

  describe("error resilience", () => {
    it("should not break on missing tool args", async () => {
      const mockCtx = { directory: "/test" } as any;
      const hook = createFetchTrackerHook(mockCtx);

      // Should not throw
      await hook["tool.execute.after"]({ tool: "webfetch", sessionID: testSessionID, args: {} }, { output: "content" });
    });

    it("should not break on undefined args", async () => {
      const mockCtx = { directory: "/test" } as any;
      const hook = createFetchTrackerHook(mockCtx);

      await hook["tool.execute.after"](
        { tool: "webfetch", sessionID: testSessionID, args: undefined },
        { output: "content" },
      );
    });
  });
});
