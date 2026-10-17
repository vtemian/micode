// tests/tools/octto/processor.test.ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AgentRun, SessionHost } from "../../../src/host/port";
import type { BaseConfig, QuestionType, SessionStore } from "../../../src/octto/session";
import { createStateStore, type StateStore } from "../../../src/octto/state";
import { processAnswer } from "../../../src/tools/octto/processor";

const SESSION_ID = "brainstorm_1";
const BROWSER_SESSION_ID = "octto_browser_1";
const BRANCH_ID = "arch";
const QUESTION_ID = "q_1";

interface Pushed {
  readonly sessionId: string;
  readonly type: QuestionType;
  readonly config: BaseConfig;
}

function fakeHost(response: unknown): SessionHost & { runs: AgentRun[]; removed: string[] } {
  const runs: AgentRun[] = [];
  const removed: string[] = [];
  return {
    runs,
    removed,
    runAgent: async (run) => {
      runs.push(run);
      return { sessionID: "ses_probe", text: `Some prose first.\n${JSON.stringify(response)}` };
    },
    remove: async (id) => {
      removed.push(id);
    },
    prompt: async () => {},
    interrupt: async () => {},
    compact: async () => "",
    lastUserText: async () => undefined,
    notify: async () => {},
  };
}

/** Only pushQuestion is reachable from processAnswer; a real store would open a browser server. */
function fakeSessions(pushed: Pushed[]): SessionStore {
  const store: Pick<SessionStore, "pushQuestion"> = {
    pushQuestion: (sessionId, type, config) => {
      pushed.push({ sessionId, type, config });
      return { question_id: `q_${pushed.length + 1}` };
    },
  };
  return store as SessionStore;
}

describe("octto probe processor", () => {
  let dir: string;
  let state: StateStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "micode-octto-probe-"));
    state = createStateStore(dir);
    await state.createSession(SESSION_ID, "Design a cache", [{ id: BRANCH_ID, scope: "Architecture" }]);
    await state.addQuestionToBranch(SESSION_ID, BRANCH_ID, {
      id: QUESTION_ID,
      type: "pick_one",
      text: "LRU or LFU?",
      config: { question: "LRU or LFU?" },
    });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("runs the probe agent without tools in a throwaway session and completes the branch", async () => {
    const host = fakeHost({ done: true, finding: "LRU with a 1k cap" });

    await processAnswer(
      state,
      fakeSessions([]),
      SESSION_ID,
      BROWSER_SESSION_ID,
      QUESTION_ID,
      { selected: "lru" },
      host,
    );

    expect(host.runs).toHaveLength(1);
    expect(host.runs[0]?.agent).toBe("probe");
    expect(host.runs[0]?.denyTools).toBe(true);
    expect(host.runs[0]?.title).toBe(`probe-${BRANCH_ID}`);
    expect(host.runs[0]?.text).toContain("<original_request>Design a cache</original_request>");
    expect(host.runs[0]?.text).toContain('<answer>{"selected":"lru"}</answer>');
    expect(host.removed).toEqual(["ses_probe"]);

    const branch = (await state.getSession(SESSION_ID))?.branches[BRANCH_ID];
    expect(branch?.status).toBe("done");
    expect(branch?.finding).toBe("LRU with a 1k cap");
  });

  it("pushes the probe's follow-up question into the browser session, scoped to the branch", async () => {
    const pushed: Pushed[] = [];
    const host = fakeHost({
      done: false,
      question: { type: "confirm", config: { question: "Evict on write?", context: "Hot path" } },
    });

    await processAnswer(
      state,
      fakeSessions(pushed),
      SESSION_ID,
      BROWSER_SESSION_ID,
      QUESTION_ID,
      { selected: "lru" },
      host,
    );

    expect(pushed).toEqual([
      {
        sessionId: BROWSER_SESSION_ID,
        type: "confirm",
        config: { question: "Evict on write?", context: "[Architecture] Hot path" },
      },
    ]);
    const branch = (await state.getSession(SESSION_ID))?.branches[BRANCH_ID];
    expect(branch?.status).toBe("exploring");
    expect(branch?.questions.map((q) => q.text)).toEqual(["LRU or LFU?", "Evict on write?"]);
  });

  it("removes the probe session even when its reply cannot be parsed", async () => {
    const host = fakeHost(undefined);
    host.runAgent = async (run) => {
      host.runs.push(run);
      return { sessionID: "ses_probe", text: "no json here" };
    };

    await processAnswer(
      state,
      fakeSessions([]),
      SESSION_ID,
      BROWSER_SESSION_ID,
      QUESTION_ID,
      { selected: "lru" },
      host,
    );

    expect(host.removed).toEqual(["ses_probe"]);
    const branch = (await state.getSession(SESSION_ID))?.branches[BRANCH_ID];
    expect(branch?.finding).toBe("Could not parse probe response");
  });

  it("propagates a host failure after recording the answer so the caller can log it", async () => {
    const host = fakeHost(undefined);
    host.runAgent = async () => {
      throw new Error("provider down");
    };

    await expect(
      processAnswer(state, fakeSessions([]), SESSION_ID, BROWSER_SESSION_ID, QUESTION_ID, { selected: "lru" }, host),
    ).rejects.toThrow("provider down");

    const question = (await state.getSession(SESSION_ID))?.branches[BRANCH_ID]?.questions[0];
    expect(question?.answer).toEqual({ selected: "lru" });
  });

  it("ignores answers to questions that belong to no branch", async () => {
    const host = fakeHost({ done: true });

    await processAnswer(state, fakeSessions([]), SESSION_ID, BROWSER_SESSION_ID, "q_unknown", { selected: "x" }, host);

    expect(host.runs).toHaveLength(0);
  });
});
