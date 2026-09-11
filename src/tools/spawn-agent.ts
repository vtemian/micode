import type { PluginInput, ToolDefinition } from "@opencode-ai/plugin";
import { type ToolContext, tool } from "@opencode-ai/plugin/tool";
import { deleteSessionModel, resolveSpawnModel, type SessionModel, setSessionModel } from "@/session-model";
import { extractErrorMessage } from "@/utils/errors";

// Extended context with metadata (available but not typed in plugin API)
// Using intersection to add optional metadata without type conflict
type ExtendedContext = ToolContext & {
  metadata?: (input: { title?: string; metadata?: Record<string, unknown> }) => void;
};

const MS_PER_SECOND = 1000;

interface SessionCreateResponse {
  readonly data?: { readonly id?: string };
}

interface MessagePart {
  readonly type: string;
  readonly text?: string;
}

interface SessionMessage {
  readonly info?: { readonly role?: "user" | "assistant" };
  readonly parts?: MessagePart[];
}

interface SessionMessagesResponse {
  readonly data?: SessionMessage[];
}

interface AgentTask {
  readonly agent: string;
  readonly prompt: string;
  readonly description: string;
}

function updateProgress(
  toolCtx: ExtendedContext,
  progressState: { completed: number; total: number; startTime: number } | undefined,
  status: string,
): void {
  if (toolCtx.metadata && progressState) {
    const elapsed = ((Date.now() - progressState.startTime) / MS_PER_SECOND).toFixed(0);
    toolCtx.metadata({
      title: `[${progressState.completed}/${progressState.total}] ${status} (${elapsed}s)`,
    });
  }
}

function lastAssistantText(messages: readonly SessionMessage[]): string {
  const lastAssistant = messages.filter((m) => m.info?.role === "assistant").pop();
  return (
    lastAssistant?.parts
      ?.filter((p) => p.type === "text" && p.text)
      .map((p) => p.text)
      .join("\n") || "(No response from agent)"
  );
}

async function executeAgentSession(
  ctx: PluginInput,
  task: AgentTask,
  model?: SessionModel,
  parentID?: string,
): Promise<string> {
  // parentID links the session under its spawner in opencode's session tree;
  // without it subagent work is invisible in the UI (#59).
  const sessionResp = (await ctx.client.session.create({
    body: parentID ? { parentID } : {},
    query: { directory: ctx.directory },
  })) as SessionCreateResponse;

  const sessionID = sessionResp.data?.id;
  if (!sessionID) {
    return `## ${task.description}\n\n**Agent**: ${task.agent}\n**Error**: Failed to create session`;
  }

  // Follow the parent session's model (set via /models) instead of the startup-baked model.
  await ctx.client.session.prompt({
    path: { id: sessionID },
    body: {
      parts: [{ type: "text", text: task.prompt }],
      agent: task.agent,
      ...(model ? { model } : {}),
    },
    query: { directory: ctx.directory },
  });

  // Propagate the model so nested spawns (e.g. executor -> implementer) keep following it.
  if (model) setSessionModel(sessionID, model);

  try {
    const messagesResp = (await ctx.client.session.messages({
      path: { id: sessionID },
      query: { directory: ctx.directory },
    })) as SessionMessagesResponse;

    return lastAssistantText(messagesResp.data || []);
  } finally {
    // The session itself must stay in the store: deleting it is what made
    // subagent work impossible to inspect after the fact (#59). Only the
    // follow-model entry is transient.
    deleteSessionModel(sessionID);
  }
}

async function runAgent(
  ctx: PluginInput,
  task: AgentTask,
  toolCtx: ExtendedContext,
  progressState?: { completed: number; total: number; startTime: number },
  agentModelOverrides?: ReadonlySet<string>,
): Promise<string> {
  const agentStartTime = Date.now();
  updateProgress(toolCtx, progressState, `Running ${task.agent}...`);

  try {
    const agentOutput = await executeAgentSession(
      ctx,
      task,
      resolveSpawnModel(toolCtx.sessionID, task.agent, agentModelOverrides),
      toolCtx.sessionID,
    );
    const agentTime = ((Date.now() - agentStartTime) / MS_PER_SECOND).toFixed(1);
    return `## ${task.description} (${agentTime}s)\n\n**Agent**: ${task.agent}\n\n### Result\n\n${agentOutput}`;
  } catch (error) {
    const errorMsg = extractErrorMessage(error);
    return `## ${task.description}\n\n**Agent**: ${task.agent}\n**Error**: ${errorMsg}`;
  }
}

async function runParallelAgents(
  ctx: PluginInput,
  agents: AgentTask[],
  extCtx: ExtendedContext,
  agentModelOverrides?: ReadonlySet<string>,
): Promise<string> {
  const startTime = Date.now();
  const progressState = { completed: 0, total: agents.length, startTime };

  extCtx.metadata?.({ title: `Running ${agents.length} agents in parallel...` });

  const runWithProgress = async (task: AgentTask): Promise<string> => {
    const agentOutput = await runAgent(ctx, task, extCtx, progressState, agentModelOverrides);
    progressState.completed++;
    const elapsed = ((Date.now() - startTime) / MS_PER_SECOND).toFixed(0);
    extCtx.metadata?.({
      title: `[${progressState.completed}/${agents.length}] ${task.agent} done (${elapsed}s)`,
    });
    return agentOutput;
  };

  const results = await Promise.all(agents.map(runWithProgress));
  const totalTime = ((Date.now() - startTime) / MS_PER_SECOND).toFixed(1);

  extCtx.metadata?.({ title: `${agents.length} agents completed in ${totalTime}s` });

  return `# ${agents.length} agents completed in ${totalTime}s (parallel)\n\n${results.join("\n\n---\n\n")}`;
}

export function createSpawnAgentTool(ctx: PluginInput, agentModelOverrides?: ReadonlySet<string>): ToolDefinition {
  return tool({
    description: `Spawn subagents to execute tasks in PARALLEL.
All agents in the array run concurrently via Promise.all.

Example:
spawn_agent({
  agents: [
    {agent: "mm-stack-detector", prompt: "...", description: "Detect stack"},
    {agent: "mm-dependency-mapper", prompt: "...", description: "Map deps"}
  ]
})`,
    args: {
      agents: tool.schema
        .array(
          tool.schema.object({
            agent: tool.schema.string().describe("Agent to spawn"),
            prompt: tool.schema.string().describe("Full prompt/instructions"),
            description: tool.schema.string().describe("Short description"),
          }),
        )
        .describe("Agents to spawn in parallel"),
    },
    execute: async (args, toolCtx) => {
      const { agents } = args;
      const extCtx = toolCtx as ExtendedContext;

      if (!agents || agents.length === 0) return "## spawn_agent Failed\n\nNo agents specified.";

      if (agents.length === 1) {
        extCtx.metadata?.({ title: `Running ${agents[0].agent}...` });
        return runAgent(ctx, agents[0], extCtx, undefined, agentModelOverrides);
      }

      return runParallelAgents(ctx, agents, extCtx, agentModelOverrides);
    },
  });
}
