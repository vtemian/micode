import { describe, expect, it } from "bun:test";

import { createContextWindowMonitorHook } from "../../src/hooks/context-window-monitor";

describe("context-window-monitor", () => {
  function createMockCtx() {
    return {
      directory: "/test",
      client: {
        session: {
          messages: async () => ({ data: [] }),
        },
        tui: {
          showToast: async () => {},
        },
      },
    } as any;
  }

  describe("createContextWindowMonitorHook", () => {
    it("should return a hook with chat.params and event handlers", () => {
      const hook = createContextWindowMonitorHook(createMockCtx());
      expect(hook["chat.params"]).toBeDefined();
      expect(hook.event).toBeDefined();
    });
  });

  describe("chat.params handler", () => {
    it("should not inject context-status when no usage data exists", async () => {
      const hook = createContextWindowMonitorHook(createMockCtx());
      const output = { system: "You are an assistant.", options: {} };

      await hook["chat.params"]({ sessionID: "s1" }, output);

      expect(output.system).toBe("You are an assistant.");
    });

    it("should inject warning message when usage exceeds warning threshold", async () => {
      const hook = createContextWindowMonitorHook(createMockCtx());

      // Simulate a message.updated event that sets usage above warning threshold (0.7)
      // claude-sonnet = 200k limit; 150k = 75% usage
      await hook.event({
        event: {
          type: "message.updated",
          properties: {
            info: {
              sessionID: "s1",
              role: "assistant",
              tokens: { input: 150_000, cache: { read: 0 } },
              modelID: "claude-sonnet",
              providerID: "anthropic",
            },
          },
        },
      });

      const output = { system: "You are an assistant.", options: {} };
      await hook["chat.params"]({ sessionID: "s1" }, output);

      expect(output.system).toContain("<context-status>");
      expect(output.system).toContain("remaining");
      expect(output.system).toContain("Plenty of room");
    });

    it("should inject critical message when usage exceeds critical threshold", async () => {
      const hook = createContextWindowMonitorHook(createMockCtx());

      // 180k / 200k = 90%, above critical threshold (0.85)
      await hook.event({
        event: {
          type: "message.updated",
          properties: {
            info: {
              sessionID: "s1",
              role: "assistant",
              tokens: { input: 180_000, cache: { read: 0 } },
              modelID: "claude-sonnet",
              providerID: "anthropic",
            },
          },
        },
      });

      const output = { system: "You are an assistant.", options: {} };
      await hook["chat.params"]({ sessionID: "s1" }, output);

      expect(output.system).toContain("<context-status>");
      expect(output.system).toContain("compacting soon");
    });

    it("should not inject when usage is below warning threshold", async () => {
      const hook = createContextWindowMonitorHook(createMockCtx());

      // 50k / 200k = 25%, well below 0.7
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

      const output = { system: "You are an assistant.", options: {} };
      await hook["chat.params"]({ sessionID: "s1" }, output);

      expect(output.system).toBe("You are an assistant.");
    });

    it("should not inject when system prompt is falsy", async () => {
      const hook = createContextWindowMonitorHook(createMockCtx());

      // Set up high usage
      await hook.event({
        event: {
          type: "message.updated",
          properties: {
            info: {
              sessionID: "s1",
              role: "assistant",
              tokens: { input: 180_000 },
              modelID: "claude-sonnet",
              providerID: "anthropic",
            },
          },
        },
      });

      const output = { system: "", options: {} };
      await hook["chat.params"]({ sessionID: "s1" }, output);

      // Empty string is falsy, so no injection
      expect(output.system).toBe("");
    });
  });

  describe("event handler - message.updated", () => {
    it("should track usage ratio per session", async () => {
      const hook = createContextWindowMonitorHook(createMockCtx());

      // 140k / 200k = 70% - right at warning threshold
      await hook.event({
        event: {
          type: "message.updated",
          properties: {
            info: {
              sessionID: "s1",
              role: "assistant",
              tokens: { input: 100_000, cache: { read: 40_000 } },
              modelID: "claude-sonnet",
              providerID: "anthropic",
            },
          },
        },
      });

      const output = { system: "System prompt.", options: {} };
      await hook["chat.params"]({ sessionID: "s1" }, output);

      expect(output.system).toContain("<context-status>");
    });

    it("should ignore user role messages", async () => {
      const hook = createContextWindowMonitorHook(createMockCtx());

      await hook.event({
        event: {
          type: "message.updated",
          properties: {
            info: {
              sessionID: "s1",
              role: "user",
              tokens: { input: 180_000 },
              modelID: "claude-sonnet",
              providerID: "anthropic",
            },
          },
        },
      });

      const output = { system: "System prompt.", options: {} };
      await hook["chat.params"]({ sessionID: "s1" }, output);

      // No usage recorded, so no injection
      expect(output.system).toBe("System prompt.");
    });

    it("should use custom model limits when provided", async () => {
      const customLimits = new Map([["custom/small-model", 50_000]]);
      const hook = createContextWindowMonitorHook(createMockCtx(), { modelContextLimits: customLimits });

      // 40k / 50k = 80% - above warning threshold
      await hook.event({
        event: {
          type: "message.updated",
          properties: {
            info: {
              sessionID: "s1",
              role: "assistant",
              tokens: { input: 40_000 },
              modelID: "small-model",
              providerID: "custom",
            },
          },
        },
      });

      const output = { system: "System prompt.", options: {} };
      await hook["chat.params"]({ sessionID: "s1" }, output);

      expect(output.system).toContain("<context-status>");
    });
  });

  describe("event handler - session.deleted", () => {
    it("should clean up session state on deletion", async () => {
      const hook = createContextWindowMonitorHook(createMockCtx());

      // Set up usage data
      await hook.event({
        event: {
          type: "message.updated",
          properties: {
            info: {
              sessionID: "s1",
              role: "assistant",
              tokens: { input: 180_000 },
              modelID: "claude-sonnet",
              providerID: "anthropic",
            },
          },
        },
      });

      // Delete session
      await hook.event({
        event: {
          type: "session.deleted",
          properties: { info: { id: "s1" } },
        },
      });

      // Usage data should be cleared
      const output = { system: "System prompt.", options: {} };
      await hook["chat.params"]({ sessionID: "s1" }, output);

      expect(output.system).toBe("System prompt.");
    });

    it("should handle missing session info on deletion", async () => {
      const hook = createContextWindowMonitorHook(createMockCtx());

      // Should not throw
      await hook.event({
        event: {
          type: "session.deleted",
          properties: {},
        },
      });
    });
  });

  describe("session isolation", () => {
    it("should track different sessions independently", async () => {
      const hook = createContextWindowMonitorHook(createMockCtx());

      // Session 1: high usage
      await hook.event({
        event: {
          type: "message.updated",
          properties: {
            info: {
              sessionID: "s1",
              role: "assistant",
              tokens: { input: 180_000 },
              modelID: "claude-sonnet",
              providerID: "anthropic",
            },
          },
        },
      });

      // Session 2: low usage
      await hook.event({
        event: {
          type: "message.updated",
          properties: {
            info: {
              sessionID: "s2",
              role: "assistant",
              tokens: { input: 20_000 },
              modelID: "claude-sonnet",
              providerID: "anthropic",
            },
          },
        },
      });

      const output1 = { system: "System.", options: {} };
      await hook["chat.params"]({ sessionID: "s1" }, output1);
      expect(output1.system).toContain("<context-status>");

      const output2 = { system: "System.", options: {} };
      await hook["chat.params"]({ sessionID: "s2" }, output2);
      expect(output2.system).toBe("System.");
    });
  });
});
