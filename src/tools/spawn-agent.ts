import { z } from "zod";

import type { SessionHost } from "@/host/port";
import { deleteSessionModel, resolveSpawnModel, type SessionModel, setSessionModel } from "@/session-model";
import { extractErrorMessage } from "@/utils/errors";

import { defineTool, type MicodeTool, type ToolCall } from "./define";

const MS_PER_SECOND = 1000;
const NO_RESPONSE = "(No response from agent)";

interface AgentTask {
  readonly agent: string;
  readonly prompt: string;
  readonly description: string;
}

interface Progress {
  completed: number;
  readonly total: number;
  readonly startTime: number;
}

function elapsedSeconds(since: number, digits = 0): string {
  return ((Date.now() - since) / MS_PER_SECOND).toFixed(digits);
}

function report(call: ToolCall, progress: Progress | undefined, status: string): void {
  if (!progress) return;
  call.progress?.(`[${progress.completed}/${progress.total}] ${status} (${elapsedSeconds(progress.startTime)}s)`);
}

async function executeAgentSession(
  host: SessionHost,
  task: AgentTask,
  model: SessionModel | undefined,
  parentID: string | undefined,
): Promise<string> {
  let childID: string | undefined;
  try {
    const reply = await host.runAgent({
      agent: task.agent,
      text: task.prompt,
      title: task.description,
      parentID,
      model,
      // Propagate the model so nested spawns (e.g. executor -> implementer) keep following it.
      onCreated: (sessionID) => {
        childID = sessionID;
        if (model) setSessionModel(sessionID, model);
      },
    });
    return reply.text || NO_RESPONSE;
  } finally {
    // The session itself stays in the store so subagent work can be inspected (#59);
    // only the follow-model entry is transient.
    if (childID) deleteSessionModel(childID);
  }
}

async function runAgent(
  host: SessionHost,
  task: AgentTask,
  call: ToolCall,
  progress: Progress | undefined,
  overrides: ReadonlySet<string> | undefined,
): Promise<string> {
  const started = Date.now();
  report(call, progress, `Running ${task.agent}...`);
  try {
    const model = call.sessionID ? resolveSpawnModel(call.sessionID, task.agent, overrides) : undefined;
    const output = await executeAgentSession(host, task, model, call.sessionID);
    return `## ${task.description} (${elapsedSeconds(started, 1)}s)\n\n**Agent**: ${task.agent}\n\n### Result\n\n${output}`;
  } catch (error) {
    return `## ${task.description}\n\n**Agent**: ${task.agent}\n**Error**: ${extractErrorMessage(error)}`;
  }
}

async function runParallelAgents(
  host: SessionHost,
  agents: readonly AgentTask[],
  call: ToolCall,
  overrides: ReadonlySet<string> | undefined,
): Promise<string> {
  const startTime = Date.now();
  const progress: Progress = { completed: 0, total: agents.length, startTime };
  call.progress?.(`Running ${agents.length} agents in parallel...`);

  const runWithProgress = async (task: AgentTask): Promise<string> => {
    const output = await runAgent(host, task, call, progress, overrides);
    progress.completed++;
    call.progress?.(`[${progress.completed}/${agents.length}] ${task.agent} done (${elapsedSeconds(startTime)}s)`);
    return output;
  };

  const results = await Promise.all(agents.map(runWithProgress));
  const total = elapsedSeconds(startTime, 1);
  call.progress?.(`${agents.length} agents completed in ${total}s`);
  return `# ${agents.length} agents completed in ${total}s (parallel)\n\n${results.join("\n\n---\n\n")}`;
}

export function createSpawnAgentTool(host: SessionHost, agentModelOverrides?: ReadonlySet<string>): MicodeTool {
  return defineTool({
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
      agents: z
        .array(
          z.object({
            agent: z.string().describe("Agent to spawn"),
            prompt: z.string().describe("Full prompt/instructions"),
            description: z.string().describe("Short description"),
          }),
        )
        .describe("Agents to spawn in parallel"),
    },
    execute: async ({ agents }, call) => {
      if (agents.length === 0) return "## spawn_agent Failed\n\nNo agents specified.";
      if (agents.length === 1) {
        call.progress?.(`Running ${agents[0].agent}...`);
        return runAgent(host, agents[0], call, undefined, agentModelOverrides);
      }
      return runParallelAgents(host, agents, call, agentModelOverrides);
    },
  });
}
