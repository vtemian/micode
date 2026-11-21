// src/octto/state/store.ts

import { STATE_DIR } from "@/octto/constants";
import type { Answer } from "@/octto/session";
import { createStatePersistence } from "./persistence";
import {
  BRANCH_STATUSES,
  type BrainstormState,
  type Branch,
  type BranchQuestion,
  type CreateBranchInput,
} from "./types";

export interface StateStore {
  createSession: (sessionId: string, request: string, branches: CreateBranchInput[]) => Promise<BrainstormState>;
  getSession: (sessionId: string) => Promise<BrainstormState | null>;
  setBrowserSessionId: (sessionId: string, browserSessionId: string) => Promise<void>;
  addQuestionToBranch: (sessionId: string, branchId: string, question: BranchQuestion) => Promise<BranchQuestion>;
  recordAnswer: (sessionId: string, questionId: string, answer: Answer) => Promise<void>;
  completeBranch: (sessionId: string, branchId: string, finding: string) => Promise<void>;
  getNextExploringBranch: (sessionId: string) => Promise<Branch | null>;
  isSessionComplete: (sessionId: string) => Promise<boolean>;
  deleteSession: (sessionId: string) => Promise<void>;
}

export function createStateStore(baseDir: string = STATE_DIR): StateStore {
  const p = createStatePersistence(baseDir);
  const queues = new Map<string, Promise<void>>();
  const lock = <T>(id: string, op: () => Promise<T>): Promise<T> => withSessionLock(queues, id, op);

  return {
    createSession: (id, request, inputs) => buildSession(p, id, request, inputs),
    getSession: (id) => p.load(id),
    setBrowserSessionId: (id, bsid) =>
      lock(id, async () => {
        const s = await loadOrThrow(p, id);
        s.browser_session_id = bsid;
        await p.save(s);
      }),
    addQuestionToBranch: (id, bid, q) => lock(id, () => addQuestion(p, id, bid, q)),
    recordAnswer: (id, qid, ans) => lock(id, () => recordAnswerOp(p, id, qid, ans)),
    completeBranch: (id, bid, f) => lock(id, () => completeBranchOp(p, id, bid, f)),
    getNextExploringBranch: (id) => findNextExploringBranch(p, id),
    isSessionComplete: async (id) => {
      const s = await p.load(id);
      return s ? Object.values(s.branches).every((b) => b.status === BRANCH_STATUSES.DONE) : false;
    },
    deleteSession: (id) => lock(id, () => p.delete(id)),
  };
}

function withSessionLock<T>(
  queues: Map<string, Promise<void>>,
  sessionId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const queue = queues.get(sessionId) ?? Promise.resolve();
  const newOperation = queue.then(operation, operation);
  queues.set(
    sessionId,
    newOperation.then(
      () => {},
      () => {},
    ),
  );
  return newOperation;
}

type Persistence = ReturnType<typeof createStatePersistence>;

async function loadOrThrow(persistence: Persistence, sessionId: string): Promise<BrainstormState> {
  const state = await persistence.load(sessionId);
  if (!state) throw new Error(`Session not found: ${sessionId}`);
  return state;
}

async function buildSession(
  persistence: Persistence,
  sessionId: string,
  request: string,
  branchInputs: CreateBranchInput[],
): Promise<BrainstormState> {
  const branches: Record<string, Branch> = {};
  const order: string[] = [];

  for (const input of branchInputs) {
    branches[input.id] = {
      id: input.id,
      scope: input.scope,
      status: BRANCH_STATUSES.EXPLORING,
      questions: [],
      finding: null,
    };
    order.push(input.id);
  }

  const state: BrainstormState = {
    session_id: sessionId,
    browser_session_id: null,
    request,
    created_at: Date.now(),
    updated_at: Date.now(),
    branches,
    branch_order: order,
  };

  await persistence.save(state);
  return state;
}

async function recordAnswerOp(
  persistence: Persistence,
  sessionId: string,
  questionId: string,
  answer: Answer,
): Promise<void> {
  const state = await loadOrThrow(persistence, sessionId);

  for (const branch of Object.values(state.branches)) {
    const question = branch.questions.find((q) => q.id === questionId);
    if (question) {
      question.answer = answer;
      question.answeredAt = Date.now();
      await persistence.save(state);
      return;
    }
  }
  throw new Error(`Question not found: ${questionId}`);
}

async function addQuestion(
  persistence: Persistence,
  sessionId: string,
  branchId: string,
  question: BranchQuestion,
): Promise<BranchQuestion> {
  const state = await loadOrThrow(persistence, sessionId);
  if (!state.branches[branchId]) throw new Error(`Branch not found: ${branchId}`);
  state.branches[branchId].questions.push(question);
  await persistence.save(state);
  return question;
}

async function completeBranchOp(
  persistence: Persistence,
  sessionId: string,
  branchId: string,
  finding: string,
): Promise<void> {
  const state = await loadOrThrow(persistence, sessionId);
  if (!state.branches[branchId]) throw new Error(`Branch not found: ${branchId}`);
  state.branches[branchId].status = BRANCH_STATUSES.DONE;
  state.branches[branchId].finding = finding;
  await persistence.save(state);
}

async function findNextExploringBranch(persistence: Persistence, sessionId: string): Promise<Branch | null> {
  const state = await persistence.load(sessionId);
  if (!state) return null;

  for (const branchId of state.branch_order) {
    const branch = state.branches[branchId];
    if (branch.status === BRANCH_STATUSES.EXPLORING) {
      return branch;
    }
  }
  return null;
}
