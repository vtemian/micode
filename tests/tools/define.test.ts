import { describe, expect, it } from "bun:test";
import { z } from "zod";

import { defineTool } from "../../src/tools/define";

describe("defineTool", () => {
  it("returns the definition unchanged so hosts can read description and args", async () => {
    const tool = defineTool({
      description: "echo",
      args: { text: z.string() },
      execute: async (args) => `got ${args.text}`,
    });

    expect(tool.description).toBe("echo");
    expect(Object.keys(tool.args)).toEqual(["text"]);
    expect(await tool.execute({ text: "hi" }, {})).toBe("got hi");
  });

  it("passes the host session id and progress reporter through the call", async () => {
    const titles: string[] = [];
    const tool = defineTool({
      description: "who",
      args: {},
      execute: async (_args, call) => {
        call.progress?.("working");
        return call.sessionID ?? "none";
      },
    });

    expect(await tool.execute({}, { sessionID: "ses_host", progress: (t) => titles.push(t) })).toBe("ses_host");
    expect(titles).toEqual(["working"]);
    expect(await tool.execute({}, {})).toBe("none");
  });
});
