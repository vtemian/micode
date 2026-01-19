// src/hooks/mindmodel-injector.ts
import type { PluginInput } from "@opencode-ai/plugin";

import {
  buildClassifierPrompt,
  formatExamplesForInjection,
  type LoadedMindmodel,
  loadExamples,
  loadMindmodel,
  parseClassifierResponse,
} from "../mindmodel";
import { log } from "../utils/logger";

type ClassifyFn = (prompt: string) => Promise<string>;

interface MessagePart {
  type: string;
  text?: string;
}

interface MessageWithParts {
  info: { role: string };
  parts: MessagePart[];
}

export function createMindmodelInjectorHook(ctx: PluginInput, classifyFn: ClassifyFn) {
  let cachedMindmodel: LoadedMindmodel | null | undefined;

  // Pending injection content (shared across hooks for current request)
  let pendingInjection: string | null = null;

  // Flag to prevent recursive classification calls
  let isClassifying = false;

  async function getMindmodel(): Promise<LoadedMindmodel | null> {
    if (cachedMindmodel === undefined) {
      cachedMindmodel = await loadMindmodel(ctx.directory);
    }
    return cachedMindmodel;
  }

  function extractTaskFromMessages(messages: MessageWithParts[]): string {
    // Get the last user message
    const lastUserMessage = [...messages].reverse().find((m) => m.info.role === "user");
    if (!lastUserMessage) return "";

    // Extract text from parts
    return lastUserMessage.parts
      .filter((p) => p.type === "text" && p.text)
      .map((p) => p.text)
      .join(" ");
  }

  return {
    // Hook 1: Extract task from messages and prepare injection
    "experimental.chat.messages.transform": async (
      _input: Record<string, unknown>,
      output: { messages: MessageWithParts[] },
    ) => {
      // Skip if we're already classifying (prevents infinite recursion)
      if (isClassifying) {
        return;
      }

      try {
        const mindmodel = await getMindmodel();
        if (!mindmodel) {
          return;
        }

        const task = extractTaskFromMessages(output.messages);
        if (!task) {
          return;
        }

        log.info("mindmodel", `Classifying task: "${task.slice(0, 100)}..."`);

        // Set flag before classification to prevent recursive calls
        isClassifying = true;

        try {
          // Classify the task
          const classifierPrompt = buildClassifierPrompt(task, mindmodel.manifest);
          const classifierResponse = await classifyFn(classifierPrompt);
          const categories = parseClassifierResponse(classifierResponse, mindmodel.manifest);

          if (categories.length === 0) {
            log.info("mindmodel", "No matching categories found");
            return;
          }

          log.info("mindmodel", `Matched categories: ${categories.join(", ")}`);

          // Load and format examples
          const examples = await loadExamples(mindmodel, categories);
          if (examples.length === 0) {
            log.info("mindmodel", "No examples found for categories");
            return;
          }

          const formatted = formatExamplesForInjection(examples);

          // Store for the system transform hook
          pendingInjection = formatted;
          log.info("mindmodel", `Prepared ${examples.length} examples for injection`);
        } finally {
          // Always reset the flag
          isClassifying = false;
        }
      } catch (error) {
        isClassifying = false;
        log.warn(
          "mindmodel",
          `Failed to prepare examples: ${error instanceof Error ? error.message : "unknown error"}`,
        );
      }
    },

    // Hook 2: Inject into system prompt
    "experimental.chat.system.transform": async (_input: { sessionID: string }, output: { system: string[] }) => {
      // Skip if we're in the middle of classification
      if (isClassifying) {
        return;
      }

      if (!pendingInjection) return;

      // Consume the pending injection
      const injection = pendingInjection;
      pendingInjection = null;

      // Prepend to system prompt
      output.system.unshift(injection);
      log.info("mindmodel", "Injected examples into system prompt");
    },
  };
}
