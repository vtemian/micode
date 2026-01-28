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
});
