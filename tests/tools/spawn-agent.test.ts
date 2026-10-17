// tests/tools/spawn-agent.test.ts
import { afterEach, describe, expect, it } from "bun:test";

import type { AgentRun, SessionHost } from "../../src/host/port";
import { deleteSessionModel, getSessionModel, setSessionModel } from "../../src/session-model";
import { createSpawnAgentTool } from "../../src/tools/spawn-agent";

/**
 * A fake session host. `remove` throws on purpose: the fix for #59 keeps
 * spawned sessions in the store, so a regression reintroducing the delete
 * surfaces as an error in the tool output.
 */
function fakeHost(runs: AgentRun[], reply = "subagent result"): SessionHost {
  return {
    runAgent: async (run) => {
      runs.push(run);
      run.onCreated?.("ses_child");
      return { sessionID: "ses_child", text: reply };
    },
    remove: async () => {
      throw new Error("spawned sessions must stay in the store (#59)");
    },
    prompt: async () => {},
    interrupt: async () => {},
    compact: async () => "",
    lastUserText: async () => undefined,
    notify: async () => {},
  };
}

describe("spawn_agent", () => {
  afterEach(() => deleteSessionModel("ses_parent"));

  const call = { sessionID: "ses_parent" };

  it("links the child session under the spawner", async () => {
    const runs: AgentRun[] = [];
    const tool = createSpawnAgentTool(fakeHost(runs));

    const output = await tool.execute(
      { agents: [{ agent: "codebase-locator", prompt: "find", description: "Locate" }] },
      call,
    );

    expect(runs[0]?.parentID).toBe("ses_parent");
    expect(runs[0]?.agent).toBe("codebase-locator");
    expect(output).toContain("subagent result");
    expect(output).not.toContain("**Error**");
  });

  it("follows the parent session's model unless the agent has an override", async () => {
    setSessionModel("ses_parent", { providerID: "anthropic", modelID: "claude-x" });
    const runs: AgentRun[] = [];
    const tool = createSpawnAgentTool(fakeHost(runs), new Set(["planner"]));

    await tool.execute(
      {
        agents: [
          { agent: "executor", prompt: "a", description: "A" },
          { agent: "planner", prompt: "b", description: "B" },
        ],
      },
      call,
    );

    const byAgent = Object.fromEntries(runs.map((r) => [r.agent, r.model]));
    expect(byAgent.executor).toEqual({ providerID: "anthropic", modelID: "claude-x" });
    expect(byAgent.planner).toBeUndefined();
    expect(getSessionModel("ses_child")).toBeUndefined();
  });

  it("reports progress through the call while agents run", async () => {
    const titles: string[] = [];
    const tool = createSpawnAgentTool(fakeHost([]));

    await tool.execute(
      {
        agents: [
          { agent: "a", prompt: "p", description: "A" },
          { agent: "b", prompt: "p", description: "B" },
        ],
      },
      { ...call, progress: (title) => titles.push(title) },
    );

    expect(titles[0]).toBe("Running 2 agents in parallel...");
    expect(titles.at(-1)).toMatch(/^2 agents completed in/);
  });

  it("reports a host failure inside the result instead of throwing", async () => {
    const host = {
      ...fakeHost([]),
      runAgent: async () => {
        throw new Error("provider down");
      },
    };
    const tool = createSpawnAgentTool(host);

    const output = await tool.execute({ agents: [{ agent: "x", prompt: "p", description: "D" }] }, call);
    expect(output).toContain("**Error**: provider down");
  });

  it("fails fast on an empty agent list", async () => {
    const tool = createSpawnAgentTool(fakeHost([]));
    expect(await tool.execute({ agents: [] }, call)).toContain("No agents specified");
  });
});
