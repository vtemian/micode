// src/tools/octto/factory.ts

import { z } from "zod";

import type { BaseConfig, QuestionType, SessionStore } from "@/octto/session";
import { defineTool } from "@/tools/define";
import { extractErrorMessage } from "@/utils/errors";
import type { OcttoTool, OcttoTools } from "./types";

type ArgsSchema = z.ZodRawShape;

interface QuestionToolConfig<T> {
  type: QuestionType;
  description: string;
  args: ArgsSchema;
  validate?: (args: T) => string | null;
  toConfig: (args: T) => BaseConfig;
}

export function createQuestionToolFactory(sessions: SessionStore) {
  return function createQuestionTool<T extends { session_id: string }>(config: QuestionToolConfig<T>): OcttoTool {
    const run = async (args: T): Promise<string> => {
      const validationError = config.validate?.(args);
      if (validationError) return `Failed: ${validationError}`;

      try {
        const questionConfig = config.toConfig(args);
        const pushed = sessions.pushQuestion(args.session_id, config.type, questionConfig);
        return `Question pushed: ${pushed.question_id}\nUse get_answer("${pushed.question_id}") to retrieve response.`;
      } catch (error) {
        return `Failed: ${extractErrorMessage(error)}`;
      }
    };

    // The caller's arg types are erased to a raw zod shape, so this is a plain
    // record instead of defineTool(): MicodeTool.execute is a method signature,
    // which lets the typed closure stand in without an assertion.
    return {
      description: `${config.description}
Returns immediately with question_id. Use get_answer to retrieve response.`,
      args: {
        session_id: z.string().describe("Session ID from start_session"),
        ...config.args,
      },
      execute: run,
    };
  };
}

const QUESTION_TYPE_ENUM = [
  "pick_one",
  "pick_many",
  "confirm",
  "ask_text",
  "ask_image",
  "ask_file",
  "ask_code",
  "show_diff",
  "show_plan",
  "show_options",
  "review_section",
  "thumbs",
  "slider",
  "rank",
  "rate",
  "emoji_react",
] as const;

/** All config properties as .any().optional() so looseObject passes them through Zod parsing. */
const pushQuestionConfigSchema = z
  .looseObject({
    question: z.string().optional(),
    context: z.string().optional(),
    options: z.any().optional(),
    min: z.any().optional(),
    max: z.any().optional(),
    step: z.any().optional(),
    recommended: z.any().optional(),
    allowOther: z.any().optional(),
    allowFeedback: z.any().optional(),
    allowCancel: z.any().optional(),
    defaultValue: z.any().optional(),
    labels: z.any().optional(),
    emojis: z.any().optional(),
    yesLabel: z.any().optional(),
    noLabel: z.any().optional(),
    before: z.any().optional(),
    after: z.any().optional(),
    filePath: z.any().optional(),
    language: z.any().optional(),
    content: z.any().optional(),
    sections: z.any().optional(),
    markdown: z.any().optional(),
    placeholder: z.any().optional(),
    multiline: z.any().optional(),
    minLength: z.any().optional(),
    maxLength: z.any().optional(),
    accept: z.any().optional(),
    multiple: z.any().optional(),
    maxImages: z.any().optional(),
    maxFiles: z.any().optional(),
    maxSize: z.any().optional(),
  })
  .describe("Question configuration (varies by type)");

function executePushQuestion(
  sessions: SessionStore,
  args: { session_id: string; type: QuestionType; config: BaseConfig },
): string {
  try {
    const pushed = sessions.pushQuestion(args.session_id, args.type, args.config);
    return `Question pushed: ${pushed.question_id}\nType: ${args.type}\nUse get_next_answer(session_id, block=true) to wait for the user's response.`;
  } catch (error) {
    return `Failed to push question: ${extractErrorMessage(error)}`;
  }
}

export function createPushQuestionTool(sessions: SessionStore): OcttoTools {
  const push_question = defineTool({
    description: `Push a question to the session queue. This is the generic tool for adding any question type.
The question will appear in the browser for the user to answer.`,
    args: {
      session_id: z.string().describe("Session ID from start_session"),
      type: z.enum(QUESTION_TYPE_ENUM).describe("Question type"),
      config: pushQuestionConfigSchema,
    },
    execute: async (args) => executePushQuestion(sessions, args),
  });

  return { push_question };
}
