import type { Hooks, Plugin } from "@opencode-ai/plugin";
import type { ToolDefinition } from "@opencode-ai/plugin/tool";

import { createV1Host, toV1Tool, type V1Host } from "@/host/v1";
import { createMicode, type Micode } from "@/micode";
import { mergePluginAgents } from "@/plugin-config";

type V1Config = Parameters<NonNullable<Hooks["config"]>>[0];
type V1Command = NonNullable<V1Config["command"]>[string];

function textOf(parts: ReadonlyArray<{ type: string; text?: string }>): string {
  return parts
    .filter((p) => p.type === "text" && typeof p.text === "string")
    .map((p) => p.text ?? "")
    .join(" ");
}

function recordArgs(args: unknown): Record<string, unknown> | undefined {
  return typeof args === "object" && args !== null ? (args as Record<string, unknown>) : undefined;
}

function toCommands(micode: Micode): Record<string, V1Command> {
  return Object.fromEntries(
    micode.commands.map((c) => [c.name, { description: c.description, agent: c.agent, template: c.template }]),
  );
}

function applyConfig(micode: Micode, cfg: V1Config): void {
  // Allow all permissions globally - no prompts
  const allowed: Record<string, "allow"> = Object.fromEntries(micode.allowedActions.map((a) => [a, "allow"]));
  cfg.permission = { ...cfg.permission, ...allowed };

  // Our agents override OpenCode defaults; native agents keep their mode (#41). The primary agent goes last.
  const pluginAgents = mergePluginAgents(cfg.agent, micode.agents);
  cfg.agent = {
    ...cfg.agent,
    ...Object.fromEntries(Object.entries(pluginAgents).filter(([k]) => k !== micode.defaultAgent)),
    [micode.defaultAgent]: pluginAgents[micode.defaultAgent],
  };

  // Keep the plugin's workflow as the entry point; an explicit user default_agent always wins.
  // The SDK's Config type lags the server on this field.
  (cfg as { default_agent?: string }).default_agent ??= micode.defaultAgent;

  // A user entry of the same name replaces the bundled server outright.
  cfg.mcp = { ...micode.mcpServers, ...cfg.mcp };
  cfg.command = { ...cfg.command, ...toCommands(micode) };
}

function hooksFor(micode: Micode, host: V1Host): Hooks {
  const tools: Record<string, ToolDefinition> = Object.fromEntries(
    Object.entries(micode.tools).map(([name, core]) => [name, toV1Tool(core)]),
  );

  return {
    tool: tools,
    config: async (cfg) => applyConfig(micode, cfg),
    "chat.message": async (input, output) => {
      const text = textOf(output.parts);
      await micode.onPrompt({ sessionID: input.sessionID, text, agent: input.agent, model: input.model });
    },
    "chat.params": async (input, output) => {
      output.options = { ...output.options, ...micode.requestOptions(input.sessionID) };
    },
    "experimental.chat.system.transform": async (input, output) => {
      if (!input.sessionID) return;
      output.system = await micode.systemPrompt({ sessionID: input.sessionID, system: output.system });
    },
    "experimental.session.compacting": async (input, output) => {
      output.prompt = micode.compactionInstruction(input.sessionID);
    },
    "tool.execute.after": async (input, output) => {
      const args: unknown = input.args;
      output.output = await micode.onToolResult({
        tool: input.tool,
        sessionID: input.sessionID,
        args: recordArgs(args),
        output: output.output,
      });
    },
    event: async ({ event }) => {
      const normalized = host.relay(event);
      if (normalized) await micode.onEvent(normalized);
    },
  };
}

const OpenCodeConfigPlugin: Plugin = async ({ client, directory }) => {
  const host = createV1Host(client, directory);
  const micode = await createMicode({ directory, host });
  return hooksFor(micode, host);
};

export { OpenCodeConfigPlugin };
