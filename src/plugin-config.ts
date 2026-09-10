// src/plugin-config.ts
// Config shaping the plugin applies to the host's opencode config.
//
// These live outside the plugin entry point on purpose: opencode calls every
// exported function in a plugin module as a plugin factory and installs each
// return value as hooks, so the entry point must export the plugin alone.

import type { AgentConfig, McpLocalConfig } from "@opencode-ai/sdk";

import type { MicodeFeatures } from "@/config-loader";

/**
 * MCP servers the plugin offers. Every one is opt-out: context7 through
 * features.context7, the research servers through their API keys. Callers
 * spread the result *under* the host config so a user's own entry always wins.
 */
export function buildMcpServers(features?: MicodeFeatures): Record<string, McpLocalConfig> {
  const servers: Record<string, McpLocalConfig> = {};

  if (features?.context7 !== false) {
    servers.context7 = {
      type: "local",
      command: ["npx", "-y", "@upstash/context7-mcp@latest"],
    };
  }

  if (process.env.PERPLEXITY_API_KEY) {
    servers.perplexity = {
      type: "local",
      command: ["npx", "-y", "@anthropic/mcp-perplexity"],
    };
  }

  if (process.env.FIRECRAWL_API_KEY) {
    servers.firecrawl = {
      type: "local",
      command: ["npx", "-y", "firecrawl-mcp"],
    };
  }

  return servers;
}

/**
 * Layer the plugin's MCP servers beneath whatever the host already declares,
 * so a user entry of the same name replaces the bundled one outright.
 */
export function mergeMcpServers<T>(
  hostServers: Record<string, T> | undefined,
  features?: MicodeFeatures,
): Record<string, T | McpLocalConfig> {
  return { ...buildMcpServers(features), ...hostServers };
}

export function mergePluginAgentConfig(existingAgent: AgentConfig | undefined, pluginAgent: AgentConfig): AgentConfig {
  return {
    ...existingAgent,
    ...pluginAgent,
  };
}

export function mergePluginAgents(
  existingAgents: Record<string, AgentConfig | undefined> | undefined,
  pluginAgents: Record<string, AgentConfig>,
): Record<string, AgentConfig> {
  return Object.fromEntries(
    Object.entries(pluginAgents).map(([name, agent]) => [name, mergePluginAgentConfig(existingAgents?.[name], agent)]),
  );
}
