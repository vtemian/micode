// src/tools/octto/processor.ts

import * as v from "valibot";
import type { Answer, QuestionType, SessionStore } from "@/octto/session";
import { BRANCH_STATUSES, type BrainstormState, type StateStore } from "@/octto/state";
import { log } from "@/utils/logger";

import type { OpencodeClient } from "./types";

// Agent name constant - matches the agent exported from src/agents/probe.ts
const PROBE_AGENT = "probe";

const ProbeQuestionSchema = v.object({
  type: v.string(),
  config: v.record(v.string(), v.unknown()),
});

const ProbeResultSchema = v.object({
  done: v.boolean(),
  finding: v.optional(v.string()),
  question: v.optional(ProbeQuestionSchema),
});

interface ProbeResult {
  done: boolean;
  finding?: string;
  question?: {
    type: QuestionType;
    config: Record<string, unknown>;
  };
}

function formatBranchQuestions(questions: { type: string; text: string; answer?: unknown }[]): string[] {
  const lines: string[] = [];
  for (const q of questions) {
    lines.push(`  <question type="${q.type}">${q.text}</question>`);
    if (q.answer) {
      lines.push(`  <answer>${JSON.stringify(q.answer)}</answer>`);
    }
  }
  return lines;
}

function formatSingleBranch(id: string, branch: BrainstormState["branches"][string], isCurrent: boolean): string[] {
  const lines: string[] = [];
  lines.push(`<branch id="${id}" scope="${branch.scope}"${isCurrent ? ' current="true"' : ""}>`);
  lines.push(...formatBranchQuestions(branch.questions));

  if (branch.status === BRANCH_STATUSES.DONE && branch.finding) {
    lines.push(`  <finding>${branch.finding}</finding>`);
  }

  lines.push("</branch>");
  return lines;
}

function formatBranchContext(state: BrainstormState, branchId: string): string {
  const lines: string[] = [`<original_request>${state.request}</original_request>`, "", "<branches>"];

  for (const [id, branch] of Object.entries(state.branches)) {
    lines.push(...formatSingleBranch(id, branch, id === branchId));
  }

  lines.push("</branches>");
  lines.push("");
  lines.push(`Evaluate the branch "${branchId}" and decide: ask another question or complete with a finding.`);

  return lines.join("\n");
}

function extractTextFromParts(parts: Array<{ type: string; text?: string }>): string {
  return parts
    .filter((part) => part.type === "text" && "text" in part)
    .map((part) => (part as { text: string }).text)
    .join("");
}

function parseProbeResponse(responseText: string): ProbeResult {
  const jsonMatch = responseText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { done: true, finding: "Could not parse probe response" };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(jsonMatch[0]);
  } catch {
    return { done: true, finding: "Could not parse probe response JSON" };
  }

  const parsed = v.safeParse(ProbeResultSchema, raw);
  if (!parsed.success) {
    return { done: true, finding: "Probe response did not match expected schema" };
  }
  return parsed.output as ProbeResult;
}

async function runProbeAgent(client: OpencodeClient, state: BrainstormState, branchId: string): Promise<ProbeResult> {
  const sessionResult = await client.session.create({
    body: { title: `probe-${branchId}` },
  });

  if (!sessionResult.data) {
    throw new Error("Failed to create probe session");
  }

  const probeSessionId = sessionResult.data.id;

  try {
    const promptResult = await client.session.prompt({
      path: { id: probeSessionId },
      body: {
        agent: PROBE_AGENT,
        tools: {},
        parts: [{ type: "text", text: formatBranchContext(state, branchId) }],
      },
    });

    if (!promptResult.data) {
      throw new Error("Failed to get probe response");
    }

    const responseText = extractTextFromParts(promptResult.data.parts);
    return parseProbeResponse(responseText);
  } finally {
    await client.session.delete({ path: { id: probeSessionId } }).catch((_e: unknown) => {
      /* fire-and-forget */
    });
  }
}

function findBranchForQuestion(state: BrainstormState, questionId: string): string | null {
  for (const [id, branch] of Object.entries(state.branches)) {
    if (branch.questions.some((q) => q.id === questionId)) return id;
  }
  return null;
}

async function recordAnswerSafe(
  stateStore: StateStore,
  sessionId: string,
  questionId: string,
  answer: Answer,
): Promise<void> {
  try {
    await stateStore.recordAnswer(sessionId, questionId, answer);
  } catch (error) {
    log.error("octto", `Failed to record answer for ${questionId}`, error);
    throw error;
  }
}

async function pushFollowUpQuestion(
  stateStore: StateStore,
  sessions: SessionStore,
  sessionId: string,
  browserSessionId: string,
  branchId: string,
  branchScope: string,
  probeQuestion: ProbeResult["question"] & object,
): Promise<void> {
  const config = probeQuestion.config as { question?: string; context?: string };
  const configWithContext = {
    ...config,
    context: `[${branchScope}] ${config.context ?? ""}`.trim(),
  };

  const { question_id: newQuestionId } = sessions.pushQuestion(browserSessionId, probeQuestion.type, configWithContext);

  await stateStore.addQuestionToBranch(sessionId, branchId, {
    id: newQuestionId,
    type: probeQuestion.type,
    text: config.question ?? "Follow-up question",
    config: configWithContext,
  });
}

export async function processAnswer(
  stateStore: StateStore,
  sessions: SessionStore,
  sessionId: string,
  browserSessionId: string,
  questionId: string,
  answer: Answer,
  client: OpencodeClient,
): Promise<void> {
  const state = await stateStore.getSession(sessionId);
  if (!state) return;

  const branchId = findBranchForQuestion(state, questionId);
  if (!branchId) return;
  if (state.branches[branchId].status === BRANCH_STATUSES.DONE) return;

  await recordAnswerSafe(stateStore, sessionId, questionId, answer);

  const updatedState = await stateStore.getSession(sessionId);
  if (!updatedState) return;

  const branch = updatedState.branches[branchId];
  if (!branch || branch.status === BRANCH_STATUSES.DONE) return;

  const probeResult = await runProbeAgent(client, updatedState, branchId);

  if (probeResult.done) {
    await stateStore.completeBranch(sessionId, branchId, probeResult.finding || "No finding");
    return;
  }

  if (probeResult.question) {
    await pushFollowUpQuestion(
      stateStore,
      sessions,
      sessionId,
      browserSessionId,
      branchId,
      branch.scope,
      probeResult.question,
    );
  }
}
