import type { Plugin } from "@opencode-ai/plugin";
import type { McpLocalConfig } from "@opencode-ai/sdk";

// Agents
import { agents } from "./agents";

// Tools
import {
  lsp_hover,
  lsp_goto_definition,
  lsp_find_references,
  lsp_document_symbols,
  lsp_workspace_symbols,
} from "./tools/lsp";
import { ast_grep_search, ast_grep_replace } from "./tools/ast-grep";

// Hooks
import { createAutoCompactHook } from "./hooks/auto-compact";
import { createContextInjectorHook } from "./hooks/context-injector";
import { createPreemptiveCompactionHook } from "./hooks/preemptive-compaction";
import { createSessionRecoveryHook } from "./hooks/session-recovery";
import { createTokenAwareTruncationHook } from "./hooks/token-aware-truncation";

// Background Task System
import { BackgroundTaskManager, createBackgroundTaskTools } from "./tools/background-task";

// Think mode: detect keywords and enable extended thinking
const THINK_KEYWORDS = [
  /\bthink\s*(hard|deeply|carefully|through)\b/i,
  /\bthink\b.*\b(about|on|through)\b/i,
  /\b(deeply|carefully)\s*think\b/i,
  /\blet('s|s)?\s*think\b/i,
];

function detectThinkKeyword(text: string): boolean {
  return THINK_KEYWORDS.some((pattern) => pattern.test(text));
}

// MCP server configurations
const MCP_SERVERS: Record<string, McpLocalConfig> = {
  context7: {
    type: "local",
    command: ["npx", "-y", "@upstash/context7-mcp@latest"],
  },
};



const OpenCodeConfigPlugin: Plugin = async (ctx) => {
  // Think mode state per session
  const thinkModeState = new Map<string, boolean>();

  // Hooks
  const autoCompactHook = createAutoCompactHook(ctx);
  const contextInjectorHook = createContextInjectorHook(ctx);
  const preemptiveCompactionHook = createPreemptiveCompactionHook(ctx);
  const sessionRecoveryHook = createSessionRecoveryHook(ctx);
  const tokenAwareTruncationHook = createTokenAwareTruncationHook(ctx);

  // Background Task System
  const backgroundTaskManager = new BackgroundTaskManager(ctx);
  const backgroundTaskTools = createBackgroundTaskTools(backgroundTaskManager);

  return {
    // Tools
    tool: {
      lsp_hover,
      lsp_goto_definition,
      lsp_find_references,
      lsp_document_symbols,
      lsp_workspace_symbols,
      ast_grep_search,
      ast_grep_replace,
      ...backgroundTaskTools,
    },

    config: async (config) => {
      // Add agents
      config.agent = {
        ...agents,
        ...config.agent,
      };

      // Add MCP servers
      config.mcp = {
        ...MCP_SERVERS,
        ...config.mcp,
      };
    },

    "chat.message": async (input, output) => {
      // Extract text from user message
      const text = output.parts
        .filter((p) => p.type === "text" && "text" in p)
        .map((p) => (p as { text: string }).text)
        .join(" ");

      // Track if think mode was requested
      thinkModeState.set(input.sessionID, detectThinkKeyword(text));
    },

    "chat.params": async (input, output) => {
      // Inject project context files
      await contextInjectorHook["chat.params"](input, output);

      // If think mode was requested, increase thinking budget
      if (thinkModeState.get(input.sessionID)) {
        output.options = {
          ...output.options,
          thinking: {
            type: "enabled",
            budget_tokens: 32000,
          },
        };
      }
    },

    // Tool output truncation
    "tool.execute.after": async (input: { tool: string; sessionID: string; callID: string }, output: { output?: string }) => {
      await tokenAwareTruncationHook["tool.execute.after"]({ name: input.tool, sessionID: input.sessionID }, output);
    },

    event: async ({ event }) => {
      // Think mode cleanup
      if (event.type === "session.deleted") {
        const props = event.properties as { info?: { id?: string } } | undefined;
        if (props?.info?.id) {
          thinkModeState.delete(props.info.id);
        }
      }

      // Run all event hooks
      await autoCompactHook.event({ event });
      await preemptiveCompactionHook.event({ event });
      await sessionRecoveryHook.event({ event });
      await tokenAwareTruncationHook.event({ event });

      // Background task manager event handling
      backgroundTaskManager.handleEvent(event);
    },
  };
};

export default OpenCodeConfigPlugin;
