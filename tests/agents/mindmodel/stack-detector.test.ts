// tests/agents/mindmodel/stack-detector.test.ts
import { describe, expect, it } from "bun:test";

import { stackDetectorAgent } from "../../../src/agents/mindmodel/stack-detector";

describe("stack-detector agent", () => {
  it("should be a subagent", () => {
    expect(stackDetectorAgent.mode).toBe("subagent");
  });

  it("should have a prompt that identifies tech stacks", () => {
    expect(stackDetectorAgent.prompt).toContain("tech stack");
    expect(stackDetectorAgent.prompt).toContain("Next.js");
    expect(stackDetectorAgent.prompt).toContain("Tailwind");
  });
});
