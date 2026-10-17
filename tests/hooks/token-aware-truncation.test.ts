import { describe, expect, it } from "bun:test";

import { createSessionUsage, type SessionUsageTracker } from "../../src/hooks/session-usage";
import { createTokenAwareTruncationHook } from "../../src/hooks/token-aware-truncation";

const MODEL = { providerID: "p", modelID: "m" };
const LIMIT = 200_000;

function usageAt(input: number): SessionUsageTracker {
  const usage = createSessionUsage(new Map([["p/m", LIMIT]]));
  usage.onEvent({ type: "assistant.usage", sessionID: "s1", input, cacheRead: 0, model: MODEL });
  return usage;
}

function manyLines(count: number, line: (i: number) => string): string {
  return Array.from({ length: count }, (_, i) => line(i)).join("\n");
}

describe("token-aware-truncation", () => {
  describe("onToolResult", () => {
    it("truncates grep output when the context window is nearly full", async () => {
      const hook = createTokenAwareTruncationHook(usageAt(190_000));
      const output = manyLines(5000, (i) => `line ${i}: some content here that takes up space`);

      const truncated = await hook.onToolResult({ tool: "grep", sessionID: "s1", output });

      expect(truncated.length).toBeLessThan(output.length);
      expect(truncated).toContain("truncated");
    });

    it("truncates glob output", async () => {
      const hook = createTokenAwareTruncationHook(usageAt(190_000));
      const output = manyLines(5000, (i) => `/path/to/file${i}.ts`);

      const truncated = await hook.onToolResult({ tool: "glob", sessionID: "s1", output });

      expect(truncated.length).toBeLessThan(output.length);
    });

    it("truncates ast_grep_search output", async () => {
      const hook = createTokenAwareTruncationHook(usageAt(190_000));
      const output = manyLines(5000, (i) => `match ${i}`);

      const truncated = await hook.onToolResult({ tool: "ast_grep_search", sessionID: "s1", output });

      expect(truncated.length).toBeLessThan(output.length);
    });

    it("leaves non-truncatable tools alone", async () => {
      const hook = createTokenAwareTruncationHook(createSessionUsage());
      expect(await hook.onToolResult({ tool: "read", sessionID: "s1", output: "x" })).toBe("x");
      expect(await hook.onToolResult({ tool: "edit", sessionID: "s1", output: "Edit applied" })).toBe("Edit applied");
    });

    it("leaves empty output alone", async () => {
      const hook = createTokenAwareTruncationHook(usageAt(190_000));
      expect(await hook.onToolResult({ tool: "grep", sessionID: "s1", output: "" })).toBe("");
    });

    it("keeps small output unchanged even for truncatable tools", async () => {
      const hook = createTokenAwareTruncationHook(usageAt(190_000));
      const output = "file1.ts\nfile2.ts\nfile3.ts";
      expect(await hook.onToolResult({ tool: "grep", sessionID: "s1", output })).toBe(output);
    });

    it("preserves header lines when truncating", async () => {
      const hook = createTokenAwareTruncationHook(usageAt(190_000));
      const headers = ["Results from search:", "Pattern: foo", "Directory: /src"];
      const output = [...headers, manyLines(5000, (i) => `  ${i}: match found in file${i}.ts`)].join("\n");

      const truncated = await hook.onToolResult({ tool: "grep", sessionID: "s1", output });

      for (const header of headers) expect(truncated).toContain(header);
      expect(truncated.length).toBeLessThan(output.length);
    });

    it("suppresses output when the context window is exhausted", async () => {
      const usage = createSessionUsage(new Map([["p/m", 1000]]));
      usage.onEvent({ type: "assistant.usage", sessionID: "s1", input: 1000, cacheRead: 0, model: MODEL });
      const hook = createTokenAwareTruncationHook(usage);

      expect(await hook.onToolResult({ tool: "grep", sessionID: "s1", output: "a\nb\nc" })).toContain(
        "[Output suppressed",
      );
    });

    it("uses the default output budget for sessions with no recorded usage", async () => {
      const hook = createTokenAwareTruncationHook(createSessionUsage());
      const output = manyLines(5000, (i) => `line ${i}: some content here that takes up space`);

      const truncated = await hook.onToolResult({ tool: "grep", sessionID: "unknown", output });

      expect(truncated.length).toBeLessThan(output.length);
      expect(truncated).toContain("truncated");
      expect(await hook.onToolResult({ tool: "grep", sessionID: "unknown", output: "a few matches" })).toBe(
        "a few matches",
      );
    });
  });
});
