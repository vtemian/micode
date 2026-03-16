// src/tools/octto/session.ts
import { tool } from "@opencode-ai/plugin/tool";

import type { SessionStore } from "@/octto/session";
import type { OcttoSessionTracker, OcttoTool, OcttoTools } from "./types";

const MISSING_QUESTIONS_ERROR = `## ERROR: questions parameter is REQUIRED

start_session MUST include questions. Browser should open with questions ready.

Example:
\`\`\`
start_session(
  title="Design Session",
  questions=[
    {type: "pick_one", config: {question: "What language?", options: [{id: "go", label: "Go"}]}},
    {type: "ask_text", config: {question: "Any constraints?"}}
  ]
)
\`\`\`

Please call start_session again WITH your prepared questions.`;

function formatSessionStartOutput(sessionId: string, url: string, questionIds?: string[]): string {
  let output = `## Session Started\n\n| Field | Value |\n|-------|-------|\n| Session ID | ${sessionId} |\n| URL | ${url} |\n`;

  if (questionIds && questionIds.length > 0) {
    output += `| Questions | ${questionIds.length} loaded |\n\n`;
    output += `**Question IDs:** ${questionIds.join(", ")}\n\n`;
    output += `Browser opened with ${questionIds.length} questions ready.\n`;
    output += `Use get_next_answer(session_id, block=true) to get answers as user responds.`;
  } else {
    output += `\nBrowser opened. Use question tools to push questions.`;
  }

  return output;
}

const sessionQuestionSchema = tool.schema
  .array(
    tool.schema.object({
      type: tool.schema
        .enum([
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
        ])
        .describe("Question type"),
      config: tool.schema
        .looseObject({
          question: tool.schema.string().optional(),
          context: tool.schema.string().optional(),
        })
        .describe("Question config (varies by type)"),
    }),
  )
  .describe("REQUIRED: Initial questions to display when browser opens. Must have at least 1.");

function buildStartSessionTool(sessions: SessionStore, tracker?: OcttoSessionTracker): OcttoTool {
  return tool({
    description: `Start an interactive octto session with initial questions.
Opens a browser window with questions already displayed - no waiting.
REQUIRED: You MUST provide at least 1 question. Will fail without questions.`,
    args: {
      title: tool.schema.string().optional().describe("Session title (shown in browser)"),
      questions: sessionQuestionSchema,
    },
    execute: async (args, context) => {
      if (!args.questions || args.questions.length === 0) return MISSING_QUESTIONS_ERROR;

      try {
        const result = await sessions.startSession({ title: args.title, questions: args.questions });
        tracker?.onCreated?.(context.sessionID, result.session_id);
        return formatSessionStartOutput(result.session_id, result.url, result.question_ids);
      } catch (error) {
        return `Failed to start session: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
  });
}

function buildEndSessionTool(sessions: SessionStore, tracker?: OcttoSessionTracker): OcttoTool {
  return tool({
    description: `End an interactive octto session.
Closes the browser window and cleans up resources.`,
    args: {
      session_id: tool.schema.string().describe("Session ID to end"),
    },
    execute: async (args, context) => {
      const result = await sessions.endSession(args.session_id);
      if (result.ok) {
        tracker?.onEnded?.(context.sessionID, args.session_id);
        return `Session ${args.session_id} ended successfully.`;
      }
      return `Failed to end session ${args.session_id}. It may not exist.`;
    },
  });
}

export function createSessionTools(sessions: SessionStore, tracker?: OcttoSessionTracker): OcttoTools {
  return {
    start_session: buildStartSessionTool(sessions, tracker),
    end_session: buildEndSessionTool(sessions, tracker),
  };
}
