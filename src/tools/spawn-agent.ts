import type { PluginInput } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin/tool";

interface SessionCreateResponse {
  data?: { id?: string };
}

interface MessagePart {
  type: string;
  text?: string;
}

interface SessionMessage {
  info?: { role?: "user" | "assistant" };
  parts?: MessagePart[];
}

interface SessionMessagesResponse {
  data?: SessionMessage[];
}

export function createSpawnAgentTool(ctx: PluginInput) {
  return tool({
    description: `FOR SUBAGENTS ONLY - Primary agents (commander, brainstormer) should use the built-in Task tool instead.
Spawn a subagent to execute a task synchronously. The agent runs to completion and returns its result.
Use this when you are a SUBAGENT (executor, planner, mm-orchestrator) and need to spawn other subagents.
For parallel execution, call spawn_agent multiple times in ONE message.`,
    args: {
      agent: tool.schema.string().describe("Agent to spawn (e.g., 'implementer', 'reviewer')"),
      prompt: tool.schema.string().describe("Full prompt/instructions for the agent"),
      description: tool.schema.string().describe("Short description of the task"),
    },
    execute: async (args) => {
      const { agent, prompt, description } = args;

      try {
        // Create new session for the subagent
        const sessionResp = (await ctx.client.session.create({
          body: {},
          query: { directory: ctx.directory },
        })) as SessionCreateResponse;

        const sessionID = sessionResp.data?.id;
        if (!sessionID) {
          return `## spawn_agent Failed\n\nFailed to create session for agent "${agent}"`;
        }

        // Run the prompt synchronously (waits for completion)
        await ctx.client.session.prompt({
          path: { id: sessionID },
          body: {
            parts: [{ type: "text", text: prompt }],
            agent: agent,
          },
          query: { directory: ctx.directory },
        });

        // Get the result from session messages
        const messagesResp = (await ctx.client.session.messages({
          path: { id: sessionID },
          query: { directory: ctx.directory },
        })) as SessionMessagesResponse;

        // Find the last assistant message
        const messages = messagesResp.data || [];
        const lastAssistant = messages.filter((m) => m.info?.role === "assistant").pop();

        const result =
          lastAssistant?.parts
            ?.filter((p) => p.type === "text" && p.text)
            .map((p) => p.text)
            .join("\n") || "(No response from agent)";

        // Clean up session
        await ctx.client.session
          .delete({
            path: { id: sessionID },
            query: { directory: ctx.directory },
          })
          .catch(() => {
            // Ignore cleanup errors
          });

        return `## ${description}\n\n**Agent**: ${agent}\n\n### Result\n\n${result}`;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        return `## spawn_agent Failed\n\n**Agent**: ${agent}\n**Error**: ${errorMsg}`;
      }
    },
  });
}
