// tests/hooks/constraint-reviewer.test.ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { captureLogs, type LogCapture } from "../helpers/log-capture";

describe("createConstraintReviewerHook", () => {
  let testDir: string;
  let logs: LogCapture;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "constraint-reviewer-test-"));
    logs = captureLogs();
  });

  afterEach(() => {
    const stray = logs.unread();
    logs.restore();
    expect(stray).toEqual([]);
    rmSync(testDir, { recursive: true, force: true });
  });

  function createMockCtx(directory: string) {
    return {
      directory,
      client: {
        session: {},
        tui: {},
      },
    };
  }

  function setupMindmodel(dir: string) {
    const mindmodelDir = join(dir, ".mindmodel");
    mkdirSync(mindmodelDir, { recursive: true });

    writeFileSync(
      join(mindmodelDir, "manifest.yaml"),
      `name: test-project
version: 2
categories:
  - path: test.md
    description: Test constraints
`,
    );

    writeFileSync(
      join(mindmodelDir, "test.md"),
      `# Test Constraints

## Rules
- Always use internal apiClient for API calls
- Never swallow errors silently
`,
    );
  }

  async function collectPrompts(filePath: string, toolOutput: string, tool = "write"): Promise<string[]> {
    const { createConstraintReviewerHook } = await import("../../src/hooks/constraint-reviewer");
    const prompts: string[] = [];
    const reviewer = async (prompt: string) => {
      prompts.push(prompt);
      return '{"status": "PASS", "violations": []}';
    };
    const hook = createConstraintReviewerHook(createMockCtx(testDir), reviewer);
    await hook["tool.execute.after"]({ tool, sessionID: "test", args: { filePath } }, { output: toolOutput });
    return prompts;
  }

  it("reviews the written file's content rather than the tool's status text", async () => {
    setupMindmodel(testDir);
    const filePath = join(testDir, "bad.ts");
    writeFileSync(filePath, "const BAD = 1;\n");

    const prompts = await collectPrompts(filePath, "Wrote file successfully.");

    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("const BAD = 1;");
    expect(prompts[0]).not.toContain("Wrote file successfully.");
  });

  it("resolves a relative file path against the workspace directory", async () => {
    setupMindmodel(testDir);
    writeFileSync(join(testDir, "rel.ts"), "const REL = 2;\n");

    const prompts = await collectPrompts("rel.ts", "Edit applied successfully.", "edit");

    expect(prompts[0]).toContain("const REL = 2;");
  });

  it("should skip review when no mindmodel exists", async () => {
    const { createConstraintReviewerHook } = await import("../../src/hooks/constraint-reviewer");

    const mockCtx = createMockCtx(testDir);
    const mockReviewer = async () => '{"status": "BLOCKED", "violations": []}';

    const hook = createConstraintReviewerHook(mockCtx, mockReviewer);

    const output = { output: "some code" };
    await hook["tool.execute.after"]({ tool: "write", sessionID: "test", args: { filePath: "test.ts" } }, output);

    // Should not modify output when no mindmodel
    expect(output.output).toBe("some code");
  });

  it("should skip review for non-Write/Edit tools", async () => {
    setupMindmodel(testDir);

    const { createConstraintReviewerHook } = await import("../../src/hooks/constraint-reviewer");

    let reviewCalled = false;
    const mockCtx = createMockCtx(testDir);
    const mockReviewer = async () => {
      reviewCalled = true;
      return '{"status": "PASS", "violations": [], "summary": "OK"}';
    };

    const hook = createConstraintReviewerHook(mockCtx, mockReviewer);

    const output = { output: "some result" };
    await hook["tool.execute.after"]({ tool: "Read", sessionID: "test", args: { filePath: "test.ts" } }, output);

    expect(reviewCalled).toBe(false);
  });

  it("should review Write operations when mindmodel exists", async () => {
    setupMindmodel(testDir);

    const { createConstraintReviewerHook } = await import("../../src/hooks/constraint-reviewer");

    let reviewCalled = false;
    const mockCtx = createMockCtx(testDir);
    const mockReviewer = async () => {
      reviewCalled = true;
      return '{"status": "PASS", "violations": [], "summary": "OK"}';
    };

    const hook = createConstraintReviewerHook(mockCtx, mockReviewer);

    const output = { output: "some code" };
    await hook["tool.execute.after"](
      {
        tool: "write",
        sessionID: "test",
        args: { filePath: join(testDir, "test.ts") },
      },
      output,
    );

    expect(reviewCalled).toBe(true);
  });

  it("should review Edit operations when mindmodel exists", async () => {
    setupMindmodel(testDir);

    const { createConstraintReviewerHook } = await import("../../src/hooks/constraint-reviewer");

    let reviewCalled = false;
    const mockCtx = createMockCtx(testDir);
    const mockReviewer = async () => {
      reviewCalled = true;
      return '{"status": "PASS", "violations": [], "summary": "OK"}';
    };

    const hook = createConstraintReviewerHook(mockCtx, mockReviewer);

    const output = { output: "edited code" };
    await hook["tool.execute.after"](
      {
        tool: "edit",
        sessionID: "test",
        args: { filePath: join(testDir, "test.ts") },
      },
      output,
    );

    expect(reviewCalled).toBe(true);
  });

  it("reviews multiedit but ignores a patch call that names no filePath", async () => {
    setupMindmodel(testDir);

    const { createConstraintReviewerHook } = await import("../../src/hooks/constraint-reviewer");

    const reviewed: string[] = [];
    const hook = createConstraintReviewerHook(createMockCtx(testDir), async (prompt) => {
      reviewed.push(prompt);
      return '{"status": "PASS", "violations": [], "summary": "OK"}';
    });

    const file = join(testDir, "test.ts");
    await hook["tool.execute.after"](
      { tool: "multiedit", sessionID: "test", args: { filePath: file } },
      { output: "x" },
    );
    await hook["tool.execute.after"]({ tool: "patch", sessionID: "test", args: { patchText: "..." } }, { output: "y" });

    expect(reviewed).toHaveLength(1);
  });

  it("should not modify output when review passes", async () => {
    setupMindmodel(testDir);

    const { createConstraintReviewerHook } = await import("../../src/hooks/constraint-reviewer");

    const mockCtx = createMockCtx(testDir);
    const mockReviewer = async () => '{"status": "PASS", "violations": [], "summary": "All good"}';

    const hook = createConstraintReviewerHook(mockCtx, mockReviewer);

    const output = { output: "clean code" };
    await hook["tool.execute.after"](
      {
        tool: "write",
        sessionID: "test",
        args: { filePath: join(testDir, "test.ts") },
      },
      output,
    );

    expect(output.output).toBe("clean code");
  });

  it("should append violations to output for retry when blocked", async () => {
    setupMindmodel(testDir);

    const { createConstraintReviewerHook } = await import("../../src/hooks/constraint-reviewer");

    const mockCtx = createMockCtx(testDir);
    const mockReviewer = async () =>
      JSON.stringify({
        status: "BLOCKED",
        violations: [
          {
            file: "src/api.ts",
            line: 15,
            rule: "Use internal client",
            constraint_file: "patterns/api.md",
            found: "fetch()",
            expected: "apiClient.get()",
          },
        ],
        summary: "Found 1 violation",
      });

    const hook = createConstraintReviewerHook(mockCtx, mockReviewer);

    const output = { output: "bad code" };
    await hook["tool.execute.after"](
      {
        tool: "write",
        sessionID: "test-session",
        args: { filePath: join(testDir, "test.ts") },
      },
      output,
    );

    // First retry: should append violations to output
    expect(output.output).toContain("constraint-violations");
    expect(output.output).toContain("Use internal client");
  });

  it("should throw ConstraintViolationError after max retries", async () => {
    setupMindmodel(testDir);

    const { createConstraintReviewerHook, ConstraintViolationError } = await import(
      "../../src/hooks/constraint-reviewer"
    );

    const mockCtx = createMockCtx(testDir);
    const mockReviewer = async () =>
      JSON.stringify({
        status: "BLOCKED",
        violations: [
          {
            file: "src/api.ts",
            line: 15,
            rule: "Use internal client",
            constraint_file: "patterns/api.md",
            found: "fetch()",
            expected: "apiClient.get()",
          },
        ],
        summary: "Found 1 violation",
      });

    const hook = createConstraintReviewerHook(mockCtx, mockReviewer);

    // First call - increments retry count
    const output1 = { output: "bad code" };
    await hook["tool.execute.after"](
      {
        tool: "write",
        sessionID: "test-session",
        args: { filePath: join(testDir, "test.ts") },
      },
      output1,
    );

    // Second call - should throw after max retries (default is 1)
    const output2 = { output: "still bad code" };
    try {
      await hook["tool.execute.after"](
        {
          tool: "write",
          sessionID: "test-session",
          args: { filePath: join(testDir, "test.ts") },
        },
        output2,
      );
      expect(true).toBe(false); // Should not reach here
    } catch (error) {
      expect(error).toBeInstanceOf(ConstraintViolationError);
      expect((error as any).result.violations).toHaveLength(1);
    }
  });

  it("should detect override command in chat messages", async () => {
    setupMindmodel(testDir);

    const { createConstraintReviewerHook } = await import("../../src/hooks/constraint-reviewer");

    let reviewCalled = false;
    const mockCtx = createMockCtx(testDir);
    const mockReviewer = async () => {
      reviewCalled = true;
      return JSON.stringify({
        status: "BLOCKED",
        violations: [
          {
            file: "test.ts",
            line: 1,
            rule: "test rule",
            constraint_file: "test.md",
            found: "x",
            expected: "y",
          },
        ],
        summary: "Blocked",
      });
    };

    const hook = createConstraintReviewerHook(mockCtx, mockReviewer);

    // First, set override via chat message
    await hook["chat.message"](
      { sessionID: "test-session" },
      { parts: [{ type: "text", text: "override: testing exception case" }] },
    );

    // Now the next tool call should skip review
    const output = { output: "bad code that would normally be blocked" };
    await hook["tool.execute.after"](
      {
        tool: "write",
        sessionID: "test-session",
        args: { filePath: join(testDir, "test.ts") },
      },
      output,
    );

    // Review should have been skipped due to override
    expect(reviewCalled).toBe(false);
    expect(output.output).toBe("bad code that would normally be blocked");
    expect(logs.info).toEqual(["[mindmodel] Override activated: testing exception case"]);
  });

  it("should reset override after one use", async () => {
    setupMindmodel(testDir);

    const { createConstraintReviewerHook } = await import("../../src/hooks/constraint-reviewer");

    let reviewCallCount = 0;
    const mockCtx = createMockCtx(testDir);
    const mockReviewer = async () => {
      reviewCallCount++;
      return '{"status": "PASS", "violations": [], "summary": "OK"}';
    };

    const hook = createConstraintReviewerHook(mockCtx, mockReviewer);

    // Set override
    await hook["chat.message"](
      { sessionID: "test-session" },
      { parts: [{ type: "text", text: "override: one-time exception" }] },
    );

    // First tool call - should skip review
    await hook["tool.execute.after"](
      {
        tool: "write",
        sessionID: "test-session",
        args: { filePath: join(testDir, "test.ts") },
      },
      { output: "code 1" },
    );

    expect(reviewCallCount).toBe(0);

    // Second tool call - should review again
    await hook["tool.execute.after"](
      {
        tool: "write",
        sessionID: "test-session",
        args: { filePath: join(testDir, "test2.ts") },
      },
      { output: "code 2" },
    );

    expect(reviewCallCount).toBe(1);
    expect(logs.info).toEqual(["[mindmodel] Override activated: one-time exception"]);
  });

  it("should skip review when args has no file_path", async () => {
    setupMindmodel(testDir);

    const { createConstraintReviewerHook } = await import("../../src/hooks/constraint-reviewer");

    let reviewCalled = false;
    const mockCtx = createMockCtx(testDir);
    const mockReviewer = async () => {
      reviewCalled = true;
      return '{"status": "PASS", "violations": [], "summary": "OK"}';
    };

    const hook = createConstraintReviewerHook(mockCtx, mockReviewer);

    const output = { output: "some code" };
    await hook["tool.execute.after"]({ tool: "write", sessionID: "test", args: {} }, output);

    expect(reviewCalled).toBe(false);
  });

  it("should gracefully handle review function errors", async () => {
    setupMindmodel(testDir);

    const { createConstraintReviewerHook } = await import("../../src/hooks/constraint-reviewer");

    const mockCtx = createMockCtx(testDir);
    const mockReviewer = async () => {
      throw new Error("Review service unavailable");
    };

    const hook = createConstraintReviewerHook(mockCtx, mockReviewer);

    // Should not throw, should gracefully degrade
    const output = { output: "some code" };
    await hook["tool.execute.after"](
      {
        tool: "write",
        sessionID: "test",
        args: { filePath: join(testDir, "test.ts") },
      },
      output,
    );

    // Output should be unchanged (graceful degradation)
    expect(output.output).toBe("some code");
    expect(logs.warn).toEqual(["[mindmodel] Review failed: Review service unavailable"]);
  });

  it("should track retry count per file, not per session", async () => {
    setupMindmodel(testDir);

    const { createConstraintReviewerHook, ConstraintViolationError } = await import(
      "../../src/hooks/constraint-reviewer"
    );

    const mockCtx = createMockCtx(testDir);
    const mockReviewer = async () =>
      JSON.stringify({
        status: "BLOCKED",
        violations: [{ file: "test", rule: "rule", constraint_file: "c.md", found: "x", expected: "y" }],
      });

    const hook = createConstraintReviewerHook(mockCtx, mockReviewer);

    // First file - first retry
    const output1 = { output: "code" };
    await hook["tool.execute.after"](
      { tool: "write", sessionID: "test-session", args: { filePath: join(testDir, "file1.ts") } },
      output1,
    );
    expect(output1.output).toContain("constraint-violations");

    // Second file - should also be first retry (not blocked), since retry count is per-file
    const output2 = { output: "code" };
    await hook["tool.execute.after"](
      { tool: "write", sessionID: "test-session", args: { filePath: join(testDir, "file2.ts") } },
      output2,
    );
    expect(output2.output).toContain("constraint-violations");

    // First file again - should now be blocked (second retry)
    try {
      await hook["tool.execute.after"](
        { tool: "write", sessionID: "test-session", args: { filePath: join(testDir, "file1.ts") } },
        { output: "code" },
      );
      expect(true).toBe(false); // Should throw
    } catch (error) {
      expect(error).toBeInstanceOf(ConstraintViolationError);
    }
  });

  it("should cleanup session state via cleanupSession", async () => {
    setupMindmodel(testDir);

    const { createConstraintReviewerHook } = await import("../../src/hooks/constraint-reviewer");

    const mockCtx = createMockCtx(testDir);
    const mockReviewer = async () =>
      JSON.stringify({
        status: "BLOCKED",
        violations: [{ file: "test", rule: "rule", constraint_file: "c.md", found: "x", expected: "y" }],
      });

    const hook = createConstraintReviewerHook(mockCtx, mockReviewer);

    // Build up some state
    await hook["tool.execute.after"](
      { tool: "write", sessionID: "cleanup-test", args: { filePath: join(testDir, "test.ts") } },
      { output: "code" },
    );

    // Cleanup
    hook.cleanupSession("cleanup-test");

    // After cleanup, retry count should be reset - so first edit should be a retry, not a block
    const output = { output: "code" };
    await hook["tool.execute.after"](
      { tool: "write", sessionID: "cleanup-test", args: { filePath: join(testDir, "test.ts") } },
      output,
    );
    // Should append violations (first retry), not throw
    expect(output.output).toContain("constraint-violations");
  });
});
