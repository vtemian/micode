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

export function createMindmodelInjectorHook(
  ctx: PluginInput,
  classifyFn: ClassifyFn,
  isInternalSession: (sessionID: string) => boolean,
) {
  let cachedMindmodel: LoadedMindmodel | null | undefined;

  // Cache pending injection per session (between hooks)
  const pendingInjection = new Map<string, string>();

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
      input: { sessionID: string },
      output: { messages: MessageWithParts[] },
    ) => {
      // Skip internal sessions (classifier, reviewer) to prevent infinite recursion
      if (isInternalSession(input.sessionID)) {
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

        // Cache for the system transform hook
        pendingInjection.set(input.sessionID, formatted);
        log.info("mindmodel", `Prepared ${examples.length} examples for injection`);
      } catch (error) {
        log.warn(
          "mindmodel",
          `Failed to prepare examples: ${error instanceof Error ? error.message : "unknown error"}`,
        );
      }
    },

    // Hook 2: Inject into system prompt
    "experimental.chat.system.transform": async (input: { sessionID: string }, output: { system: string[] }) => {
      // Skip internal sessions
      if (isInternalSession(input.sessionID)) {
        return;
      }

      const injection = pendingInjection.get(input.sessionID);
      if (!injection) return;

      // Clear the pending injection
      pendingInjection.delete(input.sessionID);

      // Prepend to system prompt
      output.system.unshift(injection);
      log.info("mindmodel", "Injected examples into system prompt");
    },
  };
}
