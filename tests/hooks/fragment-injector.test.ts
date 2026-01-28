// tests/hooks/fragment-injector.test.ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function createMockCtx(directory: string) {
  return {
    directory,
    client: {
      session: {},
      tui: {},
    },
  };
}

describe("fragment-injector", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "fragment-injector-test-"));
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("loadProjectFragments", () => {
    it("should load fragments from .micode/fragments.json", async () => {
      // Create .micode directory and fragments.json
      const micodeDir = join(testDir, ".micode");
      mkdirSync(micodeDir, { recursive: true });
      writeFileSync(
        join(micodeDir, "fragments.json"),
        JSON.stringify({
          brainstormer: ["Project-specific instruction"],
          implementer: ["Run tests after changes"],
        }),
      );

      const { loadProjectFragments } = await import("../../src/hooks/fragment-injector");
      const fragments = await loadProjectFragments(testDir);

      expect(fragments.brainstormer).toEqual(["Project-specific instruction"]);
      expect(fragments.implementer).toEqual(["Run tests after changes"]);
    });

    it("should return empty object when .micode/fragments.json does not exist", async () => {
      const { loadProjectFragments } = await import("../../src/hooks/fragment-injector");
      const fragments = await loadProjectFragments(testDir);

      expect(fragments).toEqual({});
    });

    it("should return empty object for invalid JSON", async () => {
      const micodeDir = join(testDir, ".micode");
      mkdirSync(micodeDir, { recursive: true });
      writeFileSync(join(micodeDir, "fragments.json"), "{ invalid json }");

      const { loadProjectFragments } = await import("../../src/hooks/fragment-injector");
      const fragments = await loadProjectFragments(testDir);

      expect(fragments).toEqual({});
    });

    it("should filter invalid entries same as global config", async () => {
      const micodeDir = join(testDir, ".micode");
      mkdirSync(micodeDir, { recursive: true });
      writeFileSync(
        join(micodeDir, "fragments.json"),
        JSON.stringify({
          brainstormer: ["valid", "", 123],
          planner: "not-an-array",
        }),
      );

      const { loadProjectFragments } = await import("../../src/hooks/fragment-injector");
      const fragments = await loadProjectFragments(testDir);

      expect(fragments.brainstormer).toEqual(["valid"]);
      expect(fragments.planner).toBeUndefined();
    });
  });

  describe("mergeFragments", () => {
    it("should concatenate global and project fragments", async () => {
      const { mergeFragments } = await import("../../src/hooks/fragment-injector");

      const global = {
        brainstormer: ["global instruction 1", "global instruction 2"],
        planner: ["global planner instruction"],
      };
      const project = {
        brainstormer: ["project instruction"],
        implementer: ["project implementer instruction"],
      };

      const merged = mergeFragments(global, project);

      expect(merged.brainstormer).toEqual(["global instruction 1", "global instruction 2", "project instruction"]);
      expect(merged.planner).toEqual(["global planner instruction"]);
      expect(merged.implementer).toEqual(["project implementer instruction"]);
    });

    it("should return global only when project is empty", async () => {
      const { mergeFragments } = await import("../../src/hooks/fragment-injector");

      const global = { brainstormer: ["global instruction"] };
      const project = {};

      const merged = mergeFragments(global, project);

      expect(merged.brainstormer).toEqual(["global instruction"]);
    });

    it("should return project only when global is empty", async () => {
      const { mergeFragments } = await import("../../src/hooks/fragment-injector");

      const global = {};
      const project = { brainstormer: ["project instruction"] };

      const merged = mergeFragments(global, project);

      expect(merged.brainstormer).toEqual(["project instruction"]);
    });

    it("should return empty object when both are empty", async () => {
      const { mergeFragments } = await import("../../src/hooks/fragment-injector");

      const merged = mergeFragments({}, {});

      expect(merged).toEqual({});
    });
  });

  describe("formatFragmentsBlock", () => {
    it("should format fragments as XML block with bullets", async () => {
      const { formatFragmentsBlock } = await import("../../src/hooks/fragment-injector");

      const fragments = ["Instruction one", "Instruction two"];
      const result = formatFragmentsBlock(fragments);

      expect(result).toBe(`<user-instructions>\n- Instruction one\n- Instruction two\n</user-instructions>\n\n`);
    });

    it("should return empty string for empty array", async () => {
      const { formatFragmentsBlock } = await import("../../src/hooks/fragment-injector");

      const result = formatFragmentsBlock([]);

      expect(result).toBe("");
    });

    it("should handle single fragment", async () => {
      const { formatFragmentsBlock } = await import("../../src/hooks/fragment-injector");

      const result = formatFragmentsBlock(["Single instruction"]);

      expect(result).toBe(`<user-instructions>\n- Single instruction\n</user-instructions>\n\n`);
    });
  });

  describe("createFragmentInjectorHook", () => {
    it("should inject fragments at beginning of system prompt", async () => {
      // Create project fragments
      const micodeDir = join(testDir, ".micode");
      mkdirSync(micodeDir, { recursive: true });
      writeFileSync(
        join(micodeDir, "fragments.json"),
        JSON.stringify({
          brainstormer: ["Project instruction"],
        }),
      );

      const { createFragmentInjectorHook } = await import("../../src/hooks/fragment-injector");
      const ctx = createMockCtx(testDir);
      const globalConfig = {
        fragments: {
          brainstormer: ["Global instruction"],
        },
      };

      const hooks = createFragmentInjectorHook(ctx as any, globalConfig);

      const input = { sessionID: "test-session" };
      const output = {
        system: "Original system prompt",
        options: { agent: "brainstormer" },
      };

      await hooks["chat.params"](input, output);

      expect(output.system).toContain("<user-instructions>");
      expect(output.system).toContain("- Global instruction");
      expect(output.system).toContain("- Project instruction");
      // Should be at the beginning
      expect(output.system.startsWith("<user-instructions>")).toBe(true);
      // Original content should be preserved after
      expect(output.system).toContain("Original system prompt");
    });

    it("should not inject when agent has no fragments", async () => {
      const { createFragmentInjectorHook } = await import("../../src/hooks/fragment-injector");
      const ctx = createMockCtx(testDir);
      const globalConfig = {
        fragments: {
          planner: ["Planner instruction"],
        },
      };

      const hooks = createFragmentInjectorHook(ctx as any, globalConfig);

      const input = { sessionID: "test-session" };
      const output = {
        system: "Original system prompt",
        options: { agent: "brainstormer" },
      };

      await hooks["chat.params"](input, output);

      expect(output.system).toBe("Original system prompt");
      expect(output.system).not.toContain("<user-instructions>");
    });

    it("should handle no global config", async () => {
      const micodeDir = join(testDir, ".micode");
      mkdirSync(micodeDir, { recursive: true });
      writeFileSync(
        join(micodeDir, "fragments.json"),
        JSON.stringify({
          brainstormer: ["Project only instruction"],
        }),
      );

      const { createFragmentInjectorHook } = await import("../../src/hooks/fragment-injector");
      const ctx = createMockCtx(testDir);

      const hooks = createFragmentInjectorHook(ctx as any, null);

      const input = { sessionID: "test-session" };
      const output = {
        system: "Original prompt",
        options: { agent: "brainstormer" },
      };

      await hooks["chat.params"](input, output);

      expect(output.system).toContain("Project only instruction");
    });

    it("should handle missing agent in options", async () => {
      const { createFragmentInjectorHook } = await import("../../src/hooks/fragment-injector");
      const ctx = createMockCtx(testDir);
      const globalConfig = {
        fragments: {
          brainstormer: ["Some instruction"],
        },
      };

      const hooks = createFragmentInjectorHook(ctx as any, globalConfig);

      const input = { sessionID: "test-session" };
      const output = {
        system: "Original prompt",
        options: {},
      };

      await hooks["chat.params"](input, output);

      // Should not crash, system unchanged
      expect(output.system).toBe("Original prompt");
    });
  });

  describe("warnUnknownAgents", () => {
    it("should return warning message for unknown agent names", async () => {
      const { warnUnknownAgents } = await import("../../src/hooks/fragment-injector");

      const knownAgents = new Set(["brainstormer", "planner", "implementer"]);
      const fragmentAgents = ["brainstormer", "brianstormer", "unknown-agent"];

      const warnings = warnUnknownAgents(fragmentAgents, knownAgents);

      expect(warnings).toHaveLength(2);
      expect(warnings[0]).toContain("brianstormer");
      expect(warnings[0]).toContain('Did you mean "brainstormer"?');
      expect(warnings[1]).toContain("unknown-agent");
    });

    it("should not warn for known agents", async () => {
      const { warnUnknownAgents } = await import("../../src/hooks/fragment-injector");

      const knownAgents = new Set(["brainstormer", "planner"]);
      const fragmentAgents = ["brainstormer", "planner"];

      const warnings = warnUnknownAgents(fragmentAgents, knownAgents);

      expect(warnings).toHaveLength(0);
    });

    it("should suggest closest match for typos", async () => {
      const { warnUnknownAgents } = await import("../../src/hooks/fragment-injector");

      const knownAgents = new Set(["brainstormer", "planner", "implementer", "reviewer"]);
      const fragmentAgents = ["planr", "implmenter"];

      const warnings = warnUnknownAgents(fragmentAgents, knownAgents);

      expect(warnings[0]).toContain('Did you mean "planner"?');
      expect(warnings[1]).toContain('Did you mean "implementer"?');
    });
  });
});
