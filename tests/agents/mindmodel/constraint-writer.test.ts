// tests/agents/mindmodel/constraint-writer.test.ts
import { describe, expect, it } from "bun:test";

import { constraintWriterAgent } from "../../../src/agents/mindmodel/constraint-writer";

describe("constraint-writer agent", () => {
  it("should be a subagent", () => {
    expect(constraintWriterAgent.mode).toBe("subagent");
  });

  it("should have write and edit access but not bash", () => {
    expect(constraintWriterAgent.tools?.write).toBe(true);
    expect(constraintWriterAgent.tools?.edit).toBe(true);
    expect(constraintWriterAgent.tools?.bash).toBe(false);
  });

  it("should have prompt that assembles .mindmodel/ structure", () => {
    expect(constraintWriterAgent.prompt).toContain(".mindmodel");
    expect(constraintWriterAgent.prompt).toContain("manifest");
  });
});
