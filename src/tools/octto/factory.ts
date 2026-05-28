// src/tools/octto/factory.ts

import { tool } from "@opencode-ai/plugin/tool";

import type { BaseConfig, QuestionType, SessionStore } from "@/octto/session";
import { extractErrorMessage } from "@/utils/errors";
import type { OcttoTool, OcttoTools } from "./types";

type ArgsSchema = Parameters<typeof tool>[0]["args"];

interface QuestionToolConfig<T> {
  type: QuestionType;
  description: string;
  args: ArgsSchema;
  validate?: (args: T) => string | null;
  toConfig: (args: T) => BaseConfig;
}

export function createQuestionToolFactory(sessions: SessionStore) {
  return function createQuestionTool<T extends { session_id: string }>(config: QuestionToolConfig<T>): OcttoTool {
    return tool({
      description: `${config.description}
Returns immediately with question_id. Use get_answer to retrieve response.`,
      args: {
        session_id: tool.schema.string().describe("Session ID from start_session"),
        ...config.args,
      },
      execute: async (args) => {
        const validationError = config.validate?.(args as unknown as T);
        if (validationError) return `Failed: ${validationError}`;

        try {
          const questionConfig = config.toConfig(args as unknown as T);
          const pushed = sessions.pushQuestion(args.session_id, config.type, questionConfig);
          return `Question pushed: ${pushed.question_id}\nUse get_answer("${pushed.question_id}") to retrieve response.`;
        } catch (error) {
          return `Failed: ${extractErrorMessage(error)}`;
        }
      },
    });
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
const pushQuestionConfigSchema = tool.schema
  .looseObject({
    question: tool.schema.string().optional(),
    context: tool.schema.string().optional(),
    options: tool.schema.any().optional(),
    min: tool.schema.any().optional(),
    max: tool.schema.any().optional(),
    step: tool.schema.any().optional(),
    recommended: tool.schema.any().optional(),
    allowOther: tool.schema.any().optional(),
    allowFeedback: tool.schema.any().optional(),
    allowCancel: tool.schema.any().optional(),
    defaultValue: tool.schema.any().optional(),
    labels: tool.schema.any().optional(),
    emojis: tool.schema.any().optional(),
    yesLabel: tool.schema.any().optional(),
    noLabel: tool.schema.any().optional(),
    before: tool.schema.any().optional(),
    after: tool.schema.any().optional(),
    filePath: tool.schema.any().optional(),
    language: tool.schema.any().optional(),
    content: tool.schema.any().optional(),
    sections: tool.schema.any().optional(),
    markdown: tool.schema.any().optional(),
    placeholder: tool.schema.any().optional(),
    multiline: tool.schema.any().optional(),
    minLength: tool.schema.any().optional(),
    maxLength: tool.schema.any().optional(),
    accept: tool.schema.any().optional(),
    multiple: tool.schema.any().optional(),
    maxImages: tool.schema.any().optional(),
    maxFiles: tool.schema.any().optional(),
    maxSize: tool.schema.any().optional(),
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
  const push_question = tool({
    description: `Push a question to the session queue. This is the generic tool for adding any question type.
The question will appear in the browser for the user to answer.`,
    args: {
      session_id: tool.schema.string().describe("Session ID from start_session"),
      type: tool.schema.enum(QUESTION_TYPE_ENUM).describe("Question type"),
      config: pushQuestionConfigSchema,
    },
    execute: async (args) => executePushQuestion(sessions, args),
  });

  return { push_question };
}
