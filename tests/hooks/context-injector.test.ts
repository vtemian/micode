// tests/hooks/context-injector.test.ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Mock PluginInput
function createMockCtx(directory: string) {
  return {
    directory,
    client: {
      session: {},
      tui: {},
    },
  };
}

describe("context-injector", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "context-injector-test-"));
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("tool.execute.after hook", () => {
    it("should extract filePath from tool args using camelCase", async () => {
      // Create a README.md in a subdirectory
      const subDir = join(testDir, "src", "components");
      mkdirSync(subDir, { recursive: true });
      writeFileSync(join(subDir, "README.md"), "# Components\n\nComponent documentation.");

      // Create a file to "read"
      const targetFile = join(subDir, "Button.tsx");
      writeFileSync(targetFile, "export const Button = () => <button />;");

      // Import the hook dynamically to get fresh module
      const { createContextInjectorHook } = await import("../../src/hooks/context-injector");
      const ctx = createMockCtx(testDir);
      const hooks = createContextInjectorHook(ctx as any);

      // Simulate tool execution with camelCase filePath (as OpenCode sends it)
      const input = {
        tool: "read",
        args: { filePath: targetFile }, // camelCase - this is what OpenCode sends
      };
      const output = { output: "file contents here" };

      await hooks["tool.execute.after"](input, output);

      // Should have injected directory context
      expect(output.output).toContain("directory-context");
      expect(output.output).toContain("Components");
    });

    it("should not inject context for non-file-access tools", async () => {
      const { createContextInjectorHook } = await import("../../src/hooks/context-injector");
      const ctx = createMockCtx(testDir);
      const hooks = createContextInjectorHook(ctx as any);

      const input = {
        tool: "bash",
        args: { command: "ls" },
      };
      const output = { output: "file1.txt\nfile2.txt" };

      await hooks["tool.execute.after"](input, output);

      // Should NOT have injected context
      expect(output.output).not.toContain("directory-context");
    });
  });
});
