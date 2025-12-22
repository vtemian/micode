import type { PluginInput } from "@opencode-ai/plugin";
import type { BackgroundTask, BackgroundTaskInput } from "./types";

const POLL_INTERVAL_MS = 2000;

function generateTaskId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "bg_";
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function formatDuration(start: Date, end?: Date): string {
  const ms = (end || new Date()).getTime() - start.getTime();
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);

  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

export class BackgroundTaskManager {
  private tasks: Map<string, BackgroundTask> = new Map();
  private notifications: Map<string, BackgroundTask[]> = new Map();
  private pollingInterval?: ReturnType<typeof setInterval>;
  private ctx: PluginInput;

  constructor(ctx: PluginInput) {
    this.ctx = ctx;
  }

  async launch(input: BackgroundTaskInput): Promise<BackgroundTask> {
    const taskId = generateTaskId();

    // Create new session for background task
    const sessionResp = await this.ctx.client.session.create({
      body: {},
      query: { directory: this.ctx.directory },
    });

    const sessionData = sessionResp as { data?: { id?: string } };
    const sessionID = sessionData.data?.id;

    if (!sessionID) {
      throw new Error("Failed to create background session");
    }

    const task: BackgroundTask = {
      id: taskId,
      sessionID,
      parentSessionID: input.parentSessionID,
      parentMessageID: input.parentMessageID,
      description: input.description,
      prompt: input.prompt,
      agent: input.agent,
      status: "running",
      startedAt: new Date(),
      progress: {
        toolCalls: 0,
        lastUpdate: new Date(),
      },
    };

    this.tasks.set(taskId, task);

    // Fire-and-forget prompt
    this.ctx.client.session
      .prompt({
        path: { id: sessionID },
        body: {
          parts: [{ type: "text", text: input.prompt }],
          agent: input.agent,
        },
        query: { directory: this.ctx.directory },
      })
      .catch((error) => {
        task.status = "error";
        task.error = error instanceof Error ? error.message : String(error);
        task.completedAt = new Date();
        this.markForNotification(task);
      });

    // Start polling if not already
    this.startPolling();

    return task;
  }

  async cancel(taskId: string): Promise<boolean> {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== "running") {
      return false;
    }

    try {
      // Fire-and-forget abort
      this.ctx.client.session
        .abort({
          path: { id: task.sessionID },
          query: { directory: this.ctx.directory },
        })
        .catch(() => {});

      task.status = "cancelled";
      task.completedAt = new Date();
      this.markForNotification(task);
      return true;
    } catch {
      return false;
    }
  }

  async cancelAll(): Promise<number> {
    let cancelled = 0;
    for (const task of this.tasks.values()) {
      if (task.status === "running") {
        if (await this.cancel(task.id)) {
          cancelled++;
        }
      }
    }
    return cancelled;
  }

  getTask(taskId: string): BackgroundTask | undefined {
    return this.tasks.get(taskId);
  }

  getAllTasks(): BackgroundTask[] {
    return Array.from(this.tasks.values());
  }

  getRunningTasks(): BackgroundTask[] {
    return this.getAllTasks().filter((t) => t.status === "running");
  }

  async getTaskResult(taskId: string): Promise<string | undefined> {
    const task = this.tasks.get(taskId);
    if (!task || task.status === "running") {
      return undefined;
    }

    if (task.result) {
      return task.result;
    }

    // Fetch result from session messages
    try {
      const resp = await this.ctx.client.session.messages({
        path: { id: task.sessionID },
        query: { directory: this.ctx.directory },
      });

      const messages = (resp as { data?: unknown[] }).data || [];
      const lastAssistant = [...messages].reverse().find((m) => {
        const msg = m as Record<string, unknown>;
        const info = msg.info as Record<string, unknown> | undefined;
        return info?.role === "assistant";
      }) as Record<string, unknown> | undefined;

      if (lastAssistant) {
        const parts = lastAssistant.parts as Array<{ type: string; text?: string }> | undefined;
        const textParts = parts?.filter((p) => p.type === "text") || [];
        task.result = textParts.map((p) => p.text || "").join("\n");
        return task.result;
      }
    } catch {
      // Ignore errors fetching result
    }

    return undefined;
  }

  formatTaskStatus(task: BackgroundTask): string {
    const duration = formatDuration(task.startedAt, task.completedAt);
    const status = task.status.toUpperCase();

    let output = `## Task: ${task.description}\n\n`;
    output += `| Field | Value |\n|-------|-------|\n`;
    output += `| ID | ${task.id} |\n`;
    output += `| Status | ${status} |\n`;
    output += `| Agent | ${task.agent} |\n`;
    output += `| Duration | ${duration} |\n`;

    if (task.progress) {
      output += `| Tool Calls | ${task.progress.toolCalls} |\n`;
      if (task.progress.lastTool) {
        output += `| Last Tool | ${task.progress.lastTool} |\n`;
      }
    }

    if (task.error) {
      output += `\n### Error\n${task.error}\n`;
    }

    if (task.progress?.lastMessage) {
      const preview =
        task.progress.lastMessage.length > 200
          ? task.progress.lastMessage.slice(0, 200) + "..."
          : task.progress.lastMessage;
      output += `\n### Last Message Preview\n${preview}\n`;
    }

    return output;
  }

  private startPolling(): void {
    if (this.pollingInterval) return;

    this.pollingInterval = setInterval(() => {
      this.pollRunningTasks();
    }, POLL_INTERVAL_MS);
  }

  private stopPolling(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = undefined;
    }
  }

  private async pollRunningTasks(): Promise<void> {
    const runningTasks = this.getRunningTasks();

    if (runningTasks.length === 0) {
      this.stopPolling();
      return;
    }

    for (const task of runningTasks) {
      try {
        // Check session status
        const resp = await this.ctx.client.session.get({
          path: { id: task.sessionID },
          query: { directory: this.ctx.directory },
        });

        const sessionData = resp as { data?: { status?: string } };
        const status = sessionData.data?.status;

        if (status === "idle") {
          // Task completed
          task.status = "completed";
          task.completedAt = new Date();
          await this.getTaskResult(task.id); // Cache the result
          this.markForNotification(task);

          await this.ctx.client.tui
            .showToast({
              body: {
                title: "Background Task Complete",
                message: task.description,
                variant: "success",
                duration: 5000,
              },
            })
            .catch(() => {});
        }
      } catch {
        // Session may not exist anymore
        if (task.status === "running") {
          task.status = "error";
          task.error = "Session lost";
          task.completedAt = new Date();
          this.markForNotification(task);
        }
      }
    }
  }

  private markForNotification(task: BackgroundTask): void {
    const existing = this.notifications.get(task.parentSessionID) || [];
    existing.push(task);
    this.notifications.set(task.parentSessionID, existing);
  }

  getPendingNotifications(parentSessionID: string): BackgroundTask[] {
    const notifications = this.notifications.get(parentSessionID) || [];
    this.notifications.delete(parentSessionID);
    return notifications;
  }

  handleEvent(event: { type: string; properties?: unknown }): void {
    const props = event.properties as Record<string, unknown> | undefined;

    // Track tool usage for progress
    if (event.type === "message.part.updated") {
      const info = props?.info as Record<string, unknown> | undefined;
      const sessionID = info?.sessionID as string | undefined;
      const partType = info?.type as string | undefined;

      if (sessionID && partType === "tool_use") {
        for (const task of this.tasks.values()) {
          if (task.sessionID === sessionID && task.status === "running") {
            if (!task.progress) {
              task.progress = { toolCalls: 0, lastUpdate: new Date() };
            }
            task.progress.toolCalls++;
            task.progress.lastTool = (info?.name as string) || undefined;
            task.progress.lastUpdate = new Date();
            break;
          }
        }
      }
    }

    // Cleanup on session delete
    if (event.type === "session.deleted") {
      const sessionInfo = props?.info as { id?: string } | undefined;
      if (sessionInfo?.id) {
        for (const task of this.tasks.values()) {
          if (task.sessionID === sessionInfo.id && task.status === "running") {
            task.status = "cancelled";
            task.completedAt = new Date();
          }
        }
      }
    }
  }
}
