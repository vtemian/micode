// tests/tools/spawn-agent.test.ts
import { describe, expect, it } from "bun:test";

import { createSpawnAgentTool } from "../../src/tools/spawn-agent";

interface CreateCall {
  readonly body?: { parentID?: string };
}

/**
 * A fake opencode server client. Deliberately has no session.delete: the fix
 * for #59 removed it, so a regression reintroducing the call throws here.
 */
function fakeClient(createCalls: CreateCall[]) {
  return {
    session: {
      create: async (input: CreateCall) => {
        createCalls.push(input);
        return { data: { id: "ses_child" } };
      },
      prompt: async () => ({}),
      messages: async () => ({
        data: [{ info: { role: "assistant" }, parts: [{ type: "text", text: "subagent result" }] }],
      }),
    },
  };
}

function fakeCtx(client: unknown) {
  return { client, directory: "/tmp/project" } as never;
}

const fakeToolCtx = { sessionID: "ses_parent" } as never;

describe("spawn_agent session lifecycle", () => {
  it("creates the subagent session parented to the spawning session (#59)", async () => {
    const createCalls: CreateCall[] = [];
    const tool = createSpawnAgentTool(fakeCtx(fakeClient(createCalls)));

    const result = await tool.execute(
      { agents: [{ agent: "codebase-locator", prompt: "Find files", description: "Locate" }] },
      fakeToolCtx,
    );

    expect(result).toContain("subagent result");
    expect(createCalls).toHaveLength(1);
    expect(createCalls[0].body?.parentID).toBe("ses_parent");
  });

  it("keeps the subagent session in the store after the run (#59)", async () => {
    // The fake client has no session.delete: if the tool tried to delete the
    // session, this execute would reject instead of returning the result.
    const tool = createSpawnAgentTool(fakeCtx(fakeClient([])));

    const result = await tool.execute(
      { agents: [{ agent: "codebase-locator", prompt: "Find files", description: "Locate" }] },
      fakeToolCtx,
    );

    expect(result).not.toContain("**Error**");
    expect(result).toContain("subagent result");
  });
});
