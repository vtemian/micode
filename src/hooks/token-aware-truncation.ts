import { config } from "@/utils/config";

import type { SessionUsageTracker } from "./session-usage";

// Tools that benefit from truncation
const TRUNCATABLE_TOOLS = ["grep", "glob", "ast_grep_search"];

export interface ToolResult {
  readonly tool: string;
  readonly sessionID: string;
  readonly output: string;
}

export interface TokenAwareTruncationHook {
  /** Returns the tool output, truncated to fit the session's remaining context. */
  onToolResult(result: ToolResult): Promise<string>;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / config.tokens.charsPerToken);
}

function truncateToTokenLimit(
  output: string,
  maxTokens: number,
  preserveLines: number = config.tokens.preserveHeaderLines,
): string {
  const tokens = estimateTokens(output);

  if (tokens <= maxTokens) {
    return output;
  }

  const lines = output.split("\n");

  // Preserve header lines
  const headerLines = lines.slice(0, preserveLines);
  const remainingLines = lines.slice(preserveLines);

  // Calculate available tokens for content
  const headerTokens = estimateTokens(headerLines.join("\n"));
  const truncationMsgTokens = 50; // Reserve for truncation message
  const availableTokens = maxTokens - headerTokens - truncationMsgTokens;

  if (availableTokens <= 0) {
    return `${headerLines.join("\n")}\n\n[Output truncated - context window limit reached]`;
  }

  // Accumulate lines until we hit the limit
  const resultLines: string[] = [];
  let usedTokens = 0;
  let truncatedCount = 0;

  for (const line of remainingLines) {
    const lineTokens = estimateTokens(line);
    if (usedTokens + lineTokens > availableTokens) {
      truncatedCount = remainingLines.length - resultLines.length;
      break;
    }
    resultLines.push(line);
    usedTokens += lineTokens;
  }

  if (truncatedCount === 0) {
    return output;
  }

  return [
    ...headerLines,
    ...resultLines,
    "",
    `[${truncatedCount} more lines truncated due to context window limit]`,
  ].join("\n");
}

function calculateMaxOutputTokens(used: number, limit: number): number {
  const remaining = limit - used;
  const available = Math.floor(remaining * config.tokens.safetyMargin);
  if (available <= 0) return 0;
  return Math.min(available, config.tokens.defaultMaxOutputTokens);
}

function applyTruncation(text: string, maxTokens: number): string {
  if (maxTokens <= 0) {
    return "[Output suppressed - context window exhausted. Consider compacting.]";
  }
  const tokens = estimateTokens(text);
  return tokens > maxTokens ? truncateToTokenLimit(text, maxTokens) : text;
}

export function createTokenAwareTruncationHook(usage: SessionUsageTracker): TokenAwareTruncationHook {
  return {
    onToolResult: async ({ tool, sessionID, output }) => {
      if (!TRUNCATABLE_TOOLS.includes(tool) || !output) return output;
      const current = usage.get(sessionID);
      const maxTokens = current
        ? calculateMaxOutputTokens(current.used, current.limit)
        : config.tokens.defaultMaxOutputTokens;
      return applyTruncation(output, maxTokens);
    },
  };
}
