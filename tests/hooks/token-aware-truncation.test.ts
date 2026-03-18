import { describe, expect, it } from "bun:test";

import { createTokenAwareTruncationHook } from "../../src/hooks/token-aware-truncation";

describe("token-aware-truncation", () => {
  function createMockCtx(overrides?: Record<string, unknown>) {
    return {
      directory: "/test",
      client: {
        session: {
          messages: async () => ({
            data: [
              {
                info: {
                  role: "assistant",
                  usage: { inputTokens: 50_000, cacheReadInputTokens: 0 },
                },
              },
            ],
          }),
        },
        tui: {
          showToast: async () => {},
        },
      },
      ...overrides,
    } as any;
  }

  describe("createTokenAwareTruncationHook", () => {
    it("should return a hook with event and tool.execute.after handlers", () => {
      const hook = createTokenAwareTruncationHook(createMockCtx());
      expect(hook.event).toBeDefined();
      expect(hook["tool.execute.after"]).toBeDefined();
    });
  });

  describe("tool.execute.after", () => {
    it("should truncate output for grep tool", async () => {
      const ctx = createMockCtx({
        client: {
          session: {
            messages: async () => ({
              data: [
                {
                  info: {
                    role: "assistant",
                    usage: { inputTokens: 190_000, cacheReadInputTokens: 0 },
                  },
                },
              ],
            }),
          },
        },
      });

      const hook = createTokenAwareTruncationHook(ctx);

      // Generate large output (many lines)
      const lines = Array.from({ length: 5000 }, (_, i) => `line ${i}: some content here that takes up space`);
      const output = { output: lines.join("\n") };

      await hook["tool.execute.after"]({ name: "grep", sessionID: "s1" }, output);

      // Output should be truncated
      expect(output.output.length).toBeLessThan(lines.join("\n").length);
      expect(output.output).toContain("truncated");
    });

    it("should truncate output for Grep tool (capitalized)", async () => {
      const ctx = createMockCtx({
        client: {
          session: {
            messages: async () => ({
              data: [
                {
                  info: {
                    role: "assistant",
                    usage: { inputTokens: 190_000, cacheReadInputTokens: 0 },
                  },
                },
              ],
            }),
          },
        },
      });

      const hook = createTokenAwareTruncationHook(ctx);
      const lines = Array.from({ length: 5000 }, (_, i) => `match ${i}`);
      const output = { output: lines.join("\n") };

      await hook["tool.execute.after"]({ name: "Grep", sessionID: "s1" }, output);

      expect(output.output.length).toBeLessThan(lines.join("\n").length);
    });

    it("should truncate output for glob tool", async () => {
      const ctx = createMockCtx({
        client: {
          session: {
            messages: async () => ({
              data: [
                {
                  info: {
                    role: "assistant",
                    usage: { inputTokens: 190_000, cacheReadInputTokens: 0 },
                  },
                },
              ],
            }),
          },
        },
      });

      const hook = createTokenAwareTruncationHook(ctx);
      const lines = Array.from({ length: 5000 }, (_, i) => `/path/to/file${i}.ts`);
      const output = { output: lines.join("\n") };

      await hook["tool.execute.after"]({ name: "glob", sessionID: "s1" }, output);

      expect(output.output.length).toBeLessThan(lines.join("\n").length);
    });

    it("should not truncate output for non-truncatable tools", async () => {
      const hook = createTokenAwareTruncationHook(createMockCtx());
      const original = "some file content here";
      const output = { output: original };

      await hook["tool.execute.after"]({ name: "Read", sessionID: "s1" }, output);

      expect(output.output).toBe(original);
    });

    it("should not truncate output for Edit tool", async () => {
      const hook = createTokenAwareTruncationHook(createMockCtx());
      const original = "Edit applied successfully";
      const output = { output: original };

      await hook["tool.execute.after"]({ name: "Edit", sessionID: "s1" }, output);

      expect(output.output).toBe(original);
    });

    it("should skip when output is undefined", async () => {
      const hook = createTokenAwareTruncationHook(createMockCtx());
      const output = { output: undefined };

      await hook["tool.execute.after"]({ name: "grep", sessionID: "s1" }, output);

      expect(output.output).toBeUndefined();
    });

    it("should not truncate small output even for truncatable tools", async () => {
      const hook = createTokenAwareTruncationHook(createMockCtx());
      const smallOutput = "file1.ts\nfile2.ts\nfile3.ts";
      const output = { output: smallOutput };

      await hook["tool.execute.after"]({ name: "grep", sessionID: "s1" }, output);

      expect(output.output).toBe(smallOutput);
    });

    it("should preserve header lines when truncating", async () => {
      const ctx = createMockCtx({
        client: {
          session: {
            messages: async () => ({
              data: [
                {
                  info: {
                    role: "assistant",
                    usage: { inputTokens: 190_000, cacheReadInputTokens: 0 },
                  },
                },
              ],
            }),
          },
        },
      });

      const hook = createTokenAwareTruncationHook(ctx);

      const headerLine1 = "Results from search:";
      const headerLine2 = "Pattern: foo";
      const headerLine3 = "Directory: /src";
      const contentLines = Array.from({ length: 5000 }, (_, i) => `  ${i}: match found in file${i}.ts`);
      const fullOutput = [headerLine1, headerLine2, headerLine3, ...contentLines].join("\n");
      const output = { output: fullOutput };

      await hook["tool.execute.after"]({ name: "grep", sessionID: "s1" }, output);

      // Header lines should be preserved
      expect(output.output).toContain(headerLine1);
      expect(output.output).toContain(headerLine2);
      expect(output.output).toContain(headerLine3);
    });

    it("should suppress output entirely when context is exhausted", async () => {
      const ctx = createMockCtx({
        client: {
          session: {
            messages: async () => ({
              data: [
                {
                  info: {
                    role: "assistant",
                    usage: { inputTokens: 200_000, cacheReadInputTokens: 0 },
                  },
                },
              ],
            }),
          },
        },
      });

      const hook = createTokenAwareTruncationHook(ctx);
      const output = { output: "some grep results" };

      await hook["tool.execute.after"]({ name: "grep", sessionID: "s1" }, output);

      expect(output.output).toContain("context window exhausted");
    });

    it("should handle ast_grep_search tool", async () => {
      const hook = createTokenAwareTruncationHook(createMockCtx());
      const output = { output: "match 1\nmatch 2" };

      await hook["tool.execute.after"]({ name: "ast_grep_search", sessionID: "s1" }, output);

      // Small output should pass through unchanged
      expect(output.output).toBe("match 1\nmatch 2");
    });
  });

  describe("event handler", () => {
    it("should clean up cache on session.deleted", async () => {
      const hook = createTokenAwareTruncationHook(createMockCtx());

      // Should not throw
      await hook.event({
        event: {
          type: "session.deleted",
          properties: { info: { id: "s1" } },
        },
      });
    });

    it("should handle message.updated for assistant messages", async () => {
      const hook = createTokenAwareTruncationHook(createMockCtx());

      // Should not throw; updates internal cache
      await hook.event({
        event: {
          type: "message.updated",
          properties: {
            info: {
              sessionID: "s1",
              role: "assistant",
            },
          },
        },
      });
    });

    it("should ignore message.updated for non-assistant messages", async () => {
      const hook = createTokenAwareTruncationHook(createMockCtx());

      // Should not throw
      await hook.event({
        event: {
          type: "message.updated",
          properties: {
            info: {
              sessionID: "s1",
              role: "user",
            },
          },
        },
      });
    });

    it("should handle missing session info on deletion", async () => {
      const hook = createTokenAwareTruncationHook(createMockCtx());

      await hook.event({
        event: {
          type: "session.deleted",
          properties: {},
        },
      });
    });
  });

  describe("fallback behavior", () => {
    it("should use default max tokens when session messages fetch fails", async () => {
      const ctx = createMockCtx({
        client: {
          session: {
            messages: async () => {
              throw new Error("API error");
            },
          },
        },
      });

      const hook = createTokenAwareTruncationHook(ctx);
      const smallOutput = "a few matches";
      const output = { output: smallOutput };

      await hook["tool.execute.after"]({ name: "grep", sessionID: "s1" }, output);

      // Small output should still pass through (default limit is generous)
      expect(output.output).toBe(smallOutput);
    });
  });
});
