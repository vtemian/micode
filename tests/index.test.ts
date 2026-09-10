// tests/index.test.ts
import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";

import { mergePluginAgents } from "../src/plugin-config";

describe("mergePluginAgents", () => {
  it("preserves user iteration limits from existing OpenCode agent config", () => {
    const merged = mergePluginAgents(
      {
        planner: {
          model: "user/model",
          mode: "primary",
          steps: 15,
          maxSteps: 20,
        },
      },
      {
        planner: {
          model: "plugin/model",
          mode: "subagent",
          prompt: "Planner prompt",
        },
      },
    );

    expect(merged.planner.model).toBe("plugin/model");
    expect(merged.planner.mode).toBe("subagent");
    expect(merged.planner.prompt).toBe("Planner prompt");
    expect(merged.planner.steps).toBe(15);
    expect(merged.planner.maxSteps).toBe(20);
  });
});

describe("index.ts constraint-reviewer integration", () => {
  it("should import createConstraintReviewerHook", async () => {
    const source = await readFile("src/index.ts", "utf-8");
    expect(source).toContain("createConstraintReviewerHook");
  });

  it("should create the constraint reviewer hook", async () => {
    const source = await readFile("src/index.ts", "utf-8");
    // The hook should be created with a review function
    expect(source).toContain("constraintReviewerHook");
    expect(source).toContain("createConstraintReviewerHook(ctx");
  });

  it("should call constraint reviewer hook in tool.execute.after", async () => {
    const source = await readFile("src/index.ts", "utf-8");
    // The hook should be integrated into the tool.execute.after handler
    expect(source).toContain('constraintReviewerHook["tool.execute.after"]');
  });

  it("should call constraint reviewer hook in chat.message", async () => {
    const source = await readFile("src/index.ts", "utf-8");
    // The hook should be integrated into the chat.message handler
    expect(source).toContain('constraintReviewerHook["chat.message"]');
  });

  it("should use mm-constraint-reviewer agent for review", async () => {
    const source = await readFile("src/index.ts", "utf-8");
    // The review function should use the mm-constraint-reviewer agent
    expect(source).toContain("mm-constraint-reviewer");
  });
});

describe("index.ts commands", () => {
  it("should use project-initializer agent for /init command", async () => {
    const source = await readFile("src/index.ts", "utf-8");
    // The /init command should use project-initializer
    const initCommandMatch = source.match(/init:\s*\{[^}]*agent:\s*["']([^"']+)["']/);
    expect(initCommandMatch).not.toBeNull();
    expect(initCommandMatch?.[1]).toBe("project-initializer");
  });

  it("should use mm-orchestrator agent for /mindmodel command", async () => {
    const source = await readFile("src/index.ts", "utf-8");
    // The /mindmodel command should use mm-orchestrator
    const mindmodelMatch = source.match(/mindmodel:\s*\{[^}]*agent:\s*["']([^"']+)["']/);
    expect(mindmodelMatch).not.toBeNull();
    expect(mindmodelMatch?.[1]).toBe("mm-orchestrator");
  });
});

// opencode calls every exported function in a plugin module as a plugin factory
// and treats each return value as a hooks object. A stray helper export is
// therefore never harmless: it either throws and kills registration, or returns
// something nonsensical that opencode installs as hooks. Which one happens to
// win depends on alphabetical sort order of the module namespace, so the only
// safe surface is the plugin itself.
describe("plugin module surface", () => {
  it("exports the plugin factory and nothing else callable", async () => {
    const surface: Record<string, unknown> = await import("../src/index");
    const callable = Object.entries(surface)
      .filter(([, value]) => typeof value === "function")
      .map(([name]) => name);

    expect(callable).toEqual(["OpenCodeConfigPlugin"]);
  });
});
