import { tool } from "@opencode-ai/plugin/tool";
import type { BackgroundTaskManager } from "./manager";

export function createBackgroundTaskTools(manager: BackgroundTaskManager) {
  const background_task = tool({
    description: `Launch a task to run in the background using a subagent.
The task runs independently while you continue working.
Use background_output to check progress or get results when complete.
Useful for: parallel research, concurrent implementation, async reviews.`,
    args: {
      description: tool.schema.string().describe("Short description of the task (shown in status)"),
      prompt: tool.schema.string().describe("Full prompt/instructions for the background agent"),
      agent: tool.schema.string().describe("Agent to use (e.g., 'codebase-analyzer', 'implementer')"),
    },
    execute: async (args, ctx) => {
      try {
        const task = await manager.launch({
          description: args.description,
          prompt: args.prompt,
          agent: args.agent,
          parentSessionID: ctx.sessionID,
          parentMessageID: ctx.messageID || "",
        });

        return `## Background Task Launched

| Field | Value |
|-------|-------|
| Task ID | ${task.id} |
| Agent | ${args.agent} |
| Status | RUNNING |

Use \`background_output\` with task_id="${task.id}" to check progress or get results.`;
      } catch (error) {
        return `Failed to launch background task: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
  });

  const background_output = tool({
    description: `Get status or results from a background task.
Returns immediately with current status. Use background_list to poll for completion.`,
    args: {
      task_id: tool.schema.string().describe("ID of the task to check (e.g., 'bg_abc12345')"),
    },
    execute: async (args) => {
      const { task_id } = args;

      const task = manager.getTask(task_id);
      if (!task) {
        return `Task not found: ${task_id}`;
      }

      // Format status
      let output = manager.formatTaskStatus(task);

      // Include result if completed
      if (task.status === "completed") {
        const result = await manager.getTaskResult(task_id);
        if (result) {
          output += `\n### Result\n${result}\n`;
        }
      }

      return output;
    },
  });

  const background_cancel = tool({
    description: `Cancel a running background task or all tasks.`,
    args: {
      task_id: tool.schema.string().optional().describe("ID of the task to cancel (omit to cancel all)"),
      all: tool.schema.boolean().optional().describe("Cancel all running tasks (default: false)"),
    },
    execute: async (args) => {
      const { task_id, all = false } = args;

      if (all) {
        const cancelled = await manager.cancelAll();
        return `Cancelled ${cancelled} running task(s).`;
      }

      if (!task_id) {
        return "Provide task_id or set all=true to cancel tasks.";
      }

      const success = await manager.cancel(task_id);
      if (success) {
        return `Task ${task_id} cancelled.`;
      }

      return `Could not cancel task ${task_id}. It may already be completed or not exist.`;
    },
  });

  const background_list = tool({
    description: `List all background tasks and their status.`,
    args: {},
    execute: async () => {
      const tasks = manager.getAllTasks();

      if (tasks.length === 0) {
        return "No background tasks.";
      }

      let output = "## Background Tasks\n\n";
      output += "| ID | Description | Agent | Status | Duration |\n";
      output += "|----|-------------|-------|--------|----------|\n";

      for (const task of tasks) {
        const duration = task.completedAt
          ? `${Math.round((task.completedAt.getTime() - task.startedAt.getTime()) / 1000)}s`
          : `${Math.round((Date.now() - task.startedAt.getTime()) / 1000)}s`;

        output += `| ${task.id} | ${task.description} | ${task.agent} | ${task.status} | ${duration} |\n`;
      }

      return output;
    },
  });

  return {
    background_task,
    background_output,
    background_cancel,
    background_list,
  };
}
