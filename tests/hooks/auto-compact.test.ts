import { describe, expect, it } from "bun:test";

import { type AutoCompactConfig, createAutoCompactHook } from "../../src/hooks/auto-compact";

describe("auto-compact", () => {
  function createMockCtx(overrides?: Record<string, unknown>) {
    return {
      directory: "/test",
      client: {
        session: {
          summarize: async () => {},
          messages: async () => ({ data: [] }),
          prompt: async () => {},
          abort: async () => {},
        },
        tui: {
          showToast: async () => {},
        },
      },
      ...overrides,
    } as any;
  }

  describe("createAutoCompactHook", () => {
    it("should return a hook with event handler", () => {
      const hook = createAutoCompactHook(createMockCtx());
      expect(hook.event).toBeDefined();
      expect(typeof hook.event).toBe("function");
    });

    it("should accept optional config with custom threshold", () => {
      const hookConfig: AutoCompactConfig = { compactionThreshold: 0.5 };
      const hook = createAutoCompactHook(createMockCtx(), hookConfig);
      expect(hook.event).toBeDefined();
    });
  });

  describe("session.deleted event", () => {
    it("should handle session deletion gracefully", async () => {
      const hook = createAutoCompactHook(createMockCtx());

      // Should not throw
      await hook.event({
        event: {
          type: "session.deleted",
          properties: { info: { id: "session-123" } },
        },
      });
    });

    it("should handle missing session info on deletion", async () => {
      const hook = createAutoCompactHook(createMockCtx());

      await hook.event({
        event: {
          type: "session.deleted",
          properties: {},
        },
      });
    });
  });

  describe("message.updated event", () => {
    it("should ignore non-assistant messages", async () => {
      let summarizeCalled = false;
      const ctx = createMockCtx({
        client: {
          session: {
            summarize: async () => {
              summarizeCalled = true;
            },
            messages: async () => ({ data: [] }),
            prompt: async () => {},
          },
          tui: { showToast: async () => {} },
        },
      });

      const hook = createAutoCompactHook(ctx, { compactionThreshold: 0.5 });

      await hook.event({
        event: {
          type: "message.updated",
          properties: {
            info: {
              sessionID: "s1",
              role: "user",
              tokens: { input: 100_000, cache: { read: 50_000 } },
              modelID: "claude-sonnet",
              providerID: "anthropic",
            },
          },
        },
      });

      expect(summarizeCalled).toBe(false);
    });

    it("should ignore messages without sessionID", async () => {
      let summarizeCalled = false;
      const ctx = createMockCtx({
        client: {
          session: {
            summarize: async () => {
              summarizeCalled = true;
            },
            messages: async () => ({ data: [] }),
            prompt: async () => {},
          },
          tui: { showToast: async () => {} },
        },
      });

      const hook = createAutoCompactHook(ctx, { compactionThreshold: 0.5 });

      await hook.event({
        event: {
          type: "message.updated",
          properties: {
            info: {
              role: "assistant",
              tokens: { input: 180_000 },
              modelID: "claude-sonnet",
            },
          },
        },
      });

      expect(summarizeCalled).toBe(false);
    });

    it("should ignore messages with zero tokens", async () => {
      let summarizeCalled = false;
      const ctx = createMockCtx({
        client: {
          session: {
            summarize: async () => {
              summarizeCalled = true;
            },
            messages: async () => ({ data: [] }),
            prompt: async () => {},
          },
          tui: { showToast: async () => {} },
        },
      });

      const hook = createAutoCompactHook(ctx, { compactionThreshold: 0.5 });

      await hook.event({
        event: {
          type: "message.updated",
          properties: {
            info: {
              sessionID: "s1",
              role: "assistant",
              tokens: { input: 0 },
              modelID: "claude-sonnet",
              providerID: "anthropic",
            },
          },
        },
      });

      expect(summarizeCalled).toBe(false);
    });

    it("should not trigger compaction when below threshold", async () => {
      let summarizeCalled = false;
      const ctx = createMockCtx({
        client: {
          session: {
            summarize: async () => {
              summarizeCalled = true;
            },
            messages: async () => ({ data: [] }),
            prompt: async () => {},
          },
          tui: { showToast: async () => {} },
        },
      });

      // claude-sonnet has 200k limit; 50k tokens = 25% usage, below 70%
      const hook = createAutoCompactHook(ctx);

      await hook.event({
        event: {
          type: "message.updated",
          properties: {
            info: {
              sessionID: "s1",
              role: "assistant",
              tokens: { input: 50_000, cache: { read: 0 } },
              modelID: "claude-sonnet",
              providerID: "anthropic",
            },
          },
        },
      });

      expect(summarizeCalled).toBe(false);
    });

    it("should resolve pending compaction on summary message", async () => {
      const ctx = createMockCtx();
      const hook = createAutoCompactHook(ctx);

      // A summary message should not throw
      await hook.event({
        event: {
          type: "message.updated",
          properties: {
            info: {
              sessionID: "s1",
              role: "assistant",
              summary: true,
            },
          },
        },
      });
    });

    it("should use custom model limits when provided", async () => {
      let summarizeCalled = false;
      const ctx = createMockCtx({
        client: {
          session: {
            summarize: async () => {
              summarizeCalled = true;
            },
            messages: async () => ({ data: [] }),
            prompt: async () => {},
          },
          tui: { showToast: async () => {} },
        },
      });

      // Custom limit: 100k. 40k tokens = 40% usage, below 50% threshold
      const customLimits = new Map([["anthropic/claude-sonnet", 100_000]]);
      const hook = createAutoCompactHook(ctx, {
        compactionThreshold: 0.5,
        modelContextLimits: customLimits,
      });

      await hook.event({
        event: {
          type: "message.updated",
          properties: {
            info: {
              sessionID: "s1",
              role: "assistant",
              tokens: { input: 40_000 },
              modelID: "claude-sonnet",
              providerID: "anthropic",
            },
          },
        },
      });

      expect(summarizeCalled).toBe(false);
    });
  });

  describe("unknown event types", () => {
    it("should ignore unrecognized events", async () => {
      const hook = createAutoCompactHook(createMockCtx());

      // Should not throw
      await hook.event({
        event: { type: "some.unknown.event", properties: {} },
      });
    });
  });
});
