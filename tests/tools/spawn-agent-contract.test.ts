// tests/tools/spawn-agent-contract.test.ts
//
// Guards the contract between the spawn_agent tool's argument schema and the
// prompts that teach agents how to call it.
//
// Regression: f5fd6bf ("support parallel agent execution via array") changed
// the tool from flat args to a single { agents: [...] } array, but only touched
// src/tools/spawn-agent.ts. The executor, planner and project-initializer
// prompts kept teaching the old flat form
//
//   spawn_agent(agent="implementer", prompt="...", description="...")
//
// which fails schema validation, so every batched subagent spawn returned
// "No agents specified" and parallel execution did nothing. Nothing caught it
// because the old prompt tests only asserted `toContain("spawn_agent tool")`
// (and, worse, asserted the flat string was present).
//
// These tests pin both halves of the contract: prompts must match the schema,
// and the schema must actually deliver concurrency.
import { describe, expect, it } from "bun:test";

import { executorAgent } from "../../src/agents/executor";
import { mindmodelOrchestratorAgent } from "../../src/agents/mindmodel";
import { plannerAgent } from "../../src/agents/planner";
import { projectInitializerAgent } from "../../src/agents/project-initializer";
import { createSpawnAgentTool } from "../../src/tools/spawn-agent";

/** Agents whose prompts are allowed to invoke spawn_agent. */
const SPAWNING_AGENTS = [
  ["executor", executorAgent.prompt],
  ["planner", plannerAgent.prompt],
  ["project-initializer", projectInitializerAgent.prompt],
  ["mm-orchestrator", mindmodelOrchestratorAgent.prompt],
] as const;

/** The flat form the prompts must never teach as a valid invocation. */
const FLAT_CALL = /spawn_agent\(agent=["']/;

describe("spawn_agent prompt/schema contract", () => {
  const tool = createSpawnAgentTool({ client: {}, directory: "/tmp" } as never);
  const topLevelArgs = Object.keys(tool.args);

  it("exposes exactly one top-level arg so the intended shape is unambiguous", () => {
    expect(topLevelArgs).toEqual(["agents"]);
  });

  it.each(SPAWNING_AGENTS)("%s prompt documents the array form", (_name, prompt) => {
    expect(prompt).toContain("agents");
  });

  it.each(SPAWNING_AGENTS)("%s prompt never teaches the flat form", (_name, prompt) => {
    const offending = FLAT_CALL.exec(prompt);
    // The prompts may *mention* the flat form to warn against it; what must
    // never appear is a flat call presented as something to do.
    expect(offending?.[0]).toBeUndefined();
  });

  it.each(SPAWNING_AGENTS)(
    "%s prompt shows at least one concrete spawn_agent({ agents: [...] }) call",
    (_name, prompt) => {
      expect(prompt).toMatch(/spawn_agent\(\{[\s\S]*?agents:\s*\[/);
    },
  );

  it.each(SPAWNING_AGENTS)("%s prompt shows every agent element complete, with a description", (_name, prompt) => {
    // `description` is required by the schema, so an example that omits it
    // documents a call that fails validation: the exact failure this suite
    // exists to prevent.
    const incomplete = prompt.match(/\{agent:\s*"[^"]+",\s*prompt:\s*"[^"]*"\s*\}/g) ?? [];
    expect(incomplete).toEqual([]);
  });
});

describe("spawn_agent runs its array concurrently", () => {
  /**
   * A client whose sessions resolve after `delayMs`.
   *
   * Each `create` captures its own id before awaiting, so concurrent tasks get
   * distinct sessions and the whole lifecycle (create, prompt, messages) can be
   * checked for overlap rather than just the create step.
   */
  function slowClient(delayMs: number) {
    const state = { inFlight: 0, maxInFlight: 0, started: 0, prompted: [] as string[], read: [] as string[] };
    const enter = (id: string) => {
      state.inFlight++;
      state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
      return async () => {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        state.inFlight--;
        return id;
      };
    };
    return {
      state,
      client: {
        session: {
          create: async () => {
            const id = `ses_${++state.started}`;
            return { data: { id: await enter(id)() } };
          },
          prompt: async ({ path }: { path: { id: string } }) => {
            const settle = enter(path.id);
            state.prompted.push(path.id);
            await settle();
            return {};
          },
          messages: async ({ path }: { path: { id: string } }) => {
            const settle = enter(path.id);
            state.read.push(path.id);
            await settle();
            return {
              data: [{ info: { role: "assistant" }, parts: [{ type: "text", text: `done:${path.id}` }] }],
            };
          },
        },
      },
    };
  }

  it("overlaps every agent in one call rather than serialising them", async () => {
    const { state, client } = slowClient(50);
    const tool = createSpawnAgentTool({ client, directory: "/tmp/project" } as never);

    const result = await tool.execute(
      {
        agents: [
          { agent: "implementer", prompt: "task 1", description: "Task 1" },
          { agent: "implementer", prompt: "task 2", description: "Task 2" },
          { agent: "implementer", prompt: "task 3", description: "Task 3" },
        ],
      },
      { sessionID: "ses_parent" },
    );

    expect(state.started).toBe(3);
    // Each task gets its own session: three distinct ids, not one shared one.
    expect(new Set(state.prompted).size).toBe(3);
    expect(new Set(state.read).size).toBe(3);
    // The whole point of the array: all three sessions in flight at once.
    expect(state.maxInFlight).toBe(3);
    // Serialised execution would take 3 * 50ms per stage; concurrent runs ~50ms.
    expect(result).toContain("3 agents completed");
    expect(result).toContain("done:ses_1");
    expect(result).toContain("done:ses_3");
  });

  it("reports the flat form as a failure instead of spawning nothing silently", async () => {
    const { state, client } = slowClient(1);
    const tool = createSpawnAgentTool({ client, directory: "/tmp/project" } as never);

    const result = await tool.execute(
      { agent: "implementer", prompt: "task", description: "Task" },
      { sessionID: "ses_parent" },
    );

    // Guards the failure mode the stale prompts produced.
    expect(state.started).toBe(0);
    expect(result).toContain("spawn_agent Failed");
  });
});
