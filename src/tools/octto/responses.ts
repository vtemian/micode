// src/tools/octto/responses.ts
import { z } from "zod";
import { type SessionStore, STATUSES } from "@/octto/session";
import { defineTool } from "@/tools/define";

import type { OcttoTool, OcttoTools } from "./types";

function buildGetAnswerTool(sessions: SessionStore): OcttoTool {
  return defineTool({
    description: `Get the answer to a SPECIFIC question.
By default returns immediately with current status.
Set block=true to wait for user response (with optional timeout).
NOTE: Prefer get_next_answer for better flow - it returns whichever question user answers first.`,
    args: {
      question_id: z.string().describe("Question ID from a question tool"),
      block: z.boolean().optional().describe("Wait for response (default: false)"),
      timeout: z.number().optional().describe("Max milliseconds to wait if blocking (default: 300000 = 5 min)"),
    },
    execute: async (args) => {
      const answer = await sessions.getAnswer({
        question_id: args.question_id,
        block: args.block,
        timeout: args.timeout,
      });

      if (answer.completed) {
        return `## Answer Received\n\n**Status:** ${answer.status}\n\n**Response:**\n\`\`\`json\n${JSON.stringify(answer.response, null, 2)}\n\`\`\``;
      }

      const hint =
        answer.status === STATUSES.PENDING ? "User has not answered yet. Call again with block=true to wait." : "";
      return `## Waiting for Answer\n\n**Status:** ${answer.status}\n**Reason:** ${answer.reason}\n\n${hint}`;
    },
  });
}

function buildGetNextAnswerTool(sessions: SessionStore): OcttoTool {
  return defineTool({
    description: `Wait for ANY question to be answered. Returns whichever question the user answers first.
This is the PREFERRED way to get answers - lets user answer in any order.
Push multiple questions, then call this repeatedly to get answers as they come.`,
    args: {
      session_id: z.string().describe("Session ID from start_session"),
      block: z.boolean().optional().describe("Wait for response (default: false)"),
      timeout: z.number().optional().describe("Max milliseconds to wait if blocking (default: 300000 = 5 min)"),
    },
    execute: async (args) => {
      const answer = await sessions.getNextAnswer({
        session_id: args.session_id,
        block: args.block,
        timeout: args.timeout,
      });

      if (answer.completed) {
        return `## Answer Received\n\n**Question ID:** ${answer.question_id}\n**Question Type:** ${answer.question_type}\n**Status:** ${answer.status}\n\n**Response:**\n\`\`\`json\n${JSON.stringify(answer.response, null, 2)}\n\`\`\``;
      }

      if (answer.status === STATUSES.NONE_PENDING) {
        return "## No Pending Questions\n\nAll questions have been answered or there are no questions in the queue.\nPush more questions or end the session.";
      }

      const reason = answer.reason === STATUSES.TIMEOUT ? "Timed out waiting for response." : "No answer yet.";
      return `## Waiting for Answer\n\n**Status:** ${answer.status}\n${reason}`;
    },
  });
}

function buildListQuestionsTool(sessions: SessionStore): OcttoTool {
  return defineTool({
    description: `List all questions and their status for a session.`,
    args: {
      session_id: z.string().optional().describe("Session ID (omit for all sessions)"),
    },
    execute: async (args) => {
      const listing = sessions.listQuestions(args.session_id);
      if (listing.questions.length === 0) return "No questions found.";

      let output =
        "## Questions\n\n| ID | Type | Status | Created | Answered |\n|----|------|--------|---------|----------|\n";
      for (const q of listing.questions) {
        output += `| ${q.id} | ${q.type} | ${q.status} | ${q.createdAt} | ${q.answeredAt || "-"} |\n`;
      }
      return output;
    },
  });
}

function buildCancelQuestionTool(sessions: SessionStore): OcttoTool {
  return defineTool({
    description: `Cancel a pending question.
The question will be removed from the user's queue.`,
    args: {
      question_id: z.string().describe("Question ID to cancel"),
    },
    execute: async (args) => {
      const cancellation = sessions.cancelQuestion(args.question_id);
      if (cancellation.ok) return `Question ${args.question_id} cancelled.`;
      return `Could not cancel question ${args.question_id}. It may already be answered or not exist.`;
    },
  });
}

export function createResponseTools(sessions: SessionStore): OcttoTools {
  return {
    get_answer: buildGetAnswerTool(sessions),
    get_next_answer: buildGetNextAnswerTool(sessions),
    list_questions: buildListQuestionsTool(sessions),
    cancel_question: buildCancelQuestionTool(sessions),
  };
}
