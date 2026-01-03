import { describe, it, expect, beforeEach, mock } from "bun:test";
import { BackgroundTaskManager } from "../../src/tools/background-task/manager";

// Mock the PluginInput context
function createMockCtx() {
  return {
    directory: "/test",
    client: {
      session: {
        create: mock(() => Promise.resolve({ data: { id: "session-123" } })),
        get: mock(() => Promise.resolve({ data: { status: "idle" } })),
        messages: mock(() =>
          Promise.resolve({
            data: [
              {
                info: { role: "assistant" },
                parts: [{ type: "text", text: "Task result" }],
              },
            ],
          }),
        ),
        prompt: mock(() => Promise.resolve({})),
        abort: mock(() => Promise.resolve({})),
      },
      tui: {
        showToast: mock(() => Promise.resolve({})),
      },
    },
  } as any;
}

describe("BackgroundTaskManager", () => {
  let manager: BackgroundTaskManager;
  let mockCtx: ReturnType<typeof createMockCtx>;

  beforeEach(() => {
    mockCtx = createMockCtx();
    manager = new BackgroundTaskManager(mockCtx);
  });

  describe("launch", () => {
    it("should create a task with running status", async () => {
      const task = await manager.launch({
        description: "Test task",
        prompt: "Do something",
        agent: "test-agent",
        parentSessionID: "parent-123",
        parentMessageID: "msg-123",
      });

      expect(task.id).toMatch(/^bg_[a-z0-9]{8}$/);
      expect(task.status).toBe("running");
      expect(task.description).toBe("Test task");
      expect(task.agent).toBe("test-agent");
      expect(task.sessionID).toBe("session-123");
    });

    it("should throw if session creation fails", async () => {
      mockCtx.client.session.create = mock(() => Promise.resolve({ data: {} }));

      await expect(
        manager.launch({
          description: "Test",
          prompt: "Test",
          agent: "test",
          parentSessionID: "p",
          parentMessageID: "m",
        }),
      ).rejects.toThrow("Failed to create background session");
    });

    it("should store task in internal map", async () => {
      const task = await manager.launch({
        description: "Test",
        prompt: "Test",
        agent: "test",
        parentSessionID: "p",
        parentMessageID: "m",
      });

      expect(manager.getTask(task.id)).toBe(task);
    });
  });

  describe("cancel", () => {
    it("should cancel a running task", async () => {
      const task = await manager.launch({
        description: "Test",
        prompt: "Test",
        agent: "test",
        parentSessionID: "p",
        parentMessageID: "m",
      });

      const result = await manager.cancel(task.id);

      expect(result).toBe(true);
      expect(task.status).toBe("cancelled");
      expect(task.completedAt).toBeDefined();
    });

    it("should return false for non-existent task", async () => {
      const result = await manager.cancel("non-existent");
      expect(result).toBe(false);
    });

    it("should return false for already completed task", async () => {
      const task = await manager.launch({
        description: "Test",
        prompt: "Test",
        agent: "test",
        parentSessionID: "p",
        parentMessageID: "m",
      });

      task.status = "completed";
      const result = await manager.cancel(task.id);
      expect(result).toBe(false);
    });
  });

  describe("cancelAll", () => {
    it("should cancel all running tasks", async () => {
      await manager.launch({
        description: "Task 1",
        prompt: "Test",
        agent: "test",
        parentSessionID: "p",
        parentMessageID: "m",
      });
      await manager.launch({
        description: "Task 2",
        prompt: "Test",
        agent: "test",
        parentSessionID: "p",
        parentMessageID: "m",
      });

      const cancelled = await manager.cancelAll();

      expect(cancelled).toBe(2);
      expect(manager.getRunningTasks().length).toBe(0);
    });
  });

  describe("getAllTasks", () => {
    it("should return all tasks", async () => {
      await manager.launch({
        description: "Task 1",
        prompt: "Test",
        agent: "test",
        parentSessionID: "p",
        parentMessageID: "m",
      });
      await manager.launch({
        description: "Task 2",
        prompt: "Test",
        agent: "test",
        parentSessionID: "p",
        parentMessageID: "m",
      });

      const tasks = manager.getAllTasks();
      expect(tasks.length).toBe(2);
    });
  });

  describe("getRunningTasks", () => {
    it("should only return running tasks", async () => {
      const task1 = await manager.launch({
        description: "Task 1",
        prompt: "Test",
        agent: "test",
        parentSessionID: "p",
        parentMessageID: "m",
      });
      await manager.launch({
        description: "Task 2",
        prompt: "Test",
        agent: "test",
        parentSessionID: "p",
        parentMessageID: "m",
      });

      task1.status = "completed";

      const running = manager.getRunningTasks();
      expect(running.length).toBe(1);
      expect(running[0].description).toBe("Task 2");
    });
  });

  describe("getTaskResult", () => {
    it("should return undefined for running task", async () => {
      const task = await manager.launch({
        description: "Test",
        prompt: "Test",
        agent: "test",
        parentSessionID: "p",
        parentMessageID: "m",
      });

      const result = await manager.getTaskResult(task.id);
      expect(result).toBeUndefined();
    });

    it("should fetch and cache result for completed task", async () => {
      const task = await manager.launch({
        description: "Test",
        prompt: "Test",
        agent: "test",
        parentSessionID: "p",
        parentMessageID: "m",
      });

      task.status = "completed";
      const result = await manager.getTaskResult(task.id);

      expect(result).toBe("Task result");
      expect(task.result).toBe("Task result");

      // Second call should use cached result
      const result2 = await manager.getTaskResult(task.id);
      expect(result2).toBe("Task result");
      expect(mockCtx.client.session.messages).toHaveBeenCalledTimes(1);
    });
  });

  describe("formatTaskStatus", () => {
    it("should format task status as markdown table", async () => {
      const task = await manager.launch({
        description: "Test task",
        prompt: "Test",
        agent: "test-agent",
        parentSessionID: "p",
        parentMessageID: "m",
      });

      const output = manager.formatTaskStatus(task);

      expect(output).toContain("## Task: Test task");
      expect(output).toContain("| ID |");
      expect(output).toContain("| Status | RUNNING |");
      expect(output).toContain("| Agent | test-agent |");
    });

    it("should include error if present", async () => {
      const task = await manager.launch({
        description: "Test",
        prompt: "Test",
        agent: "test",
        parentSessionID: "p",
        parentMessageID: "m",
      });

      task.status = "error";
      task.error = "Something went wrong";

      const output = manager.formatTaskStatus(task);
      expect(output).toContain("### Error");
      expect(output).toContain("Something went wrong");
    });
  });

  describe("handleEvent", () => {
    it("should track tool usage from message.part.updated events", async () => {
      const task = await manager.launch({
        description: "Test",
        prompt: "Test",
        agent: "test",
        parentSessionID: "p",
        parentMessageID: "m",
      });

      manager.handleEvent({
        type: "message.part.updated",
        properties: {
          info: {
            sessionID: task.sessionID,
            type: "tool_use",
            name: "read",
          },
        },
      });

      expect(task.progress?.toolCalls).toBe(1);
      expect(task.progress?.lastTool).toBe("read");
    });

    it("should cancel task on session.deleted event", async () => {
      const task = await manager.launch({
        description: "Test",
        prompt: "Test",
        agent: "test",
        parentSessionID: "p",
        parentMessageID: "m",
      });

      manager.handleEvent({
        type: "session.deleted",
        properties: {
          info: { id: task.sessionID },
        },
      });

      expect(task.status).toBe("cancelled");
    });
  });
});
