import type { PluginInput } from "@opencode-ai/plugin";

const MAX_COMMENT_PREVIEW_LENGTH = 60;
const MAX_CONSECUTIVE_COMMENTS = 5;
const MAX_ISSUES_SHOWN = 3;

// Patterns that indicate excessive/unnecessary comments
const EXCESSIVE_COMMENT_PATTERNS = [
  // Obvious comments that explain what code does (not why)
  /\/\/\s*(increment|decrement|add|subtract|set|get|return|call|create|initialize|init)\s+/i,
  /\/\/\s*(the|this|a|an)\s+(following|above|below|next|previous)/i,
  // Section dividers
  /\/\/\s*[-=]{3,}/,
  /\/\/\s*#{3,}/,
  // Empty or whitespace-only comments
  /\/\/\s*$/,
  // "End of" comments
  /\/\/\s*end\s+(of|function|class|method|if|loop|for|while)/i,
];

// Patterns that are valid and should be ignored
const VALID_COMMENT_PATTERNS = [
  // TODO/FIXME/NOTE comments
  /\/\/\s*(TODO|FIXME|NOTE|HACK|XXX|BUG|WARN):/i,
  // JSDoc/TSDoc
  /^\s*\*|\/\*\*/,
  // Directive comments (eslint, prettier, ts, etc.)
  /\/\/\s*@|\/\/\s*eslint|\/\/\s*prettier|\/\/\s*ts-|\/\/\s*type:/i,
  // License headers
  /\/\/\s*(copyright|license|spdx)/i,
  // BDD-style comments (describe, it, given, when, then)
  /\/\/\s*(given|when|then|and|but|describe|it|should|expect)/i,
  // URL references
  /\/\/\s*https?:\/\//i,
  // Regex explanations (often necessary)
  /\/\/\s*regex|\/\/\s*pattern/i,
];

interface CommentIssue {
  line: number;
  comment: string;
  reason: string;
}

function analyzeComments(content: string): CommentIssue[] {
  const issues: CommentIssue[] = [];
  const lines = content.split("\n");

  let consecutiveComments = 0;
  let lastCommentLine = -2;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    const isComment = trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*");
    if (!isComment) continue;

    // Skip valid patterns
    if (isValidComment(trimmed)) continue;

    checkExcessivePattern(trimmed, i, issues);

    const isConsecutive = i === lastCommentLine + 1;
    consecutiveComments = isConsecutive ? consecutiveComments + 1 : 1;

    if (consecutiveComments > MAX_CONSECUTIVE_COMMENTS) {
      issues.push({
        line: i + 1,
        comment: trimmed.slice(0, MAX_COMMENT_PREVIEW_LENGTH),
        reason: "Excessive consecutive comments",
      });
    }

    lastCommentLine = i;
  }

  return issues;
}

function isValidComment(trimmed: string): boolean {
  return VALID_COMMENT_PATTERNS.some((p) => p.test(trimmed));
}

function checkExcessivePattern(trimmed: string, lineIndex: number, issues: CommentIssue[]): void {
  for (const pattern of EXCESSIVE_COMMENT_PATTERNS) {
    if (!pattern.test(trimmed)) continue;

    issues.push({
      line: lineIndex + 1,
      comment:
        trimmed.slice(0, MAX_COMMENT_PREVIEW_LENGTH) + (trimmed.length > MAX_COMMENT_PREVIEW_LENGTH ? "..." : ""),
      reason: "Explains what, not why",
    });
    break;
  }
}

interface CommentCheckerHooks {
  "tool.execute.after": (
    input: { tool: string; args?: Record<string, unknown> },
    output: { output?: string },
  ) => Promise<void>;
}

export function createCommentCheckerHook(_ctx: PluginInput): CommentCheckerHooks {
  return {
    // Check after file edits
    "tool.execute.after": async (
      input: { tool: string; args?: Record<string, unknown> },
      output: { output?: string },
    ) => {
      // Only check Edit tool
      if (input.tool !== "Edit" && input.tool !== "edit") return;

      const replacement = input.args?.new_string as string | undefined;
      if (!replacement) return;

      const issues = analyzeComments(replacement);

      if (issues.length > 0) {
        const warning = formatCommentWarning(issues);

        if (output.output) {
          output.output += warning;
        }
      }
    },
  };
}

function formatCommentWarning(issues: CommentIssue[]): string {
  const shown = issues
    .slice(0, MAX_ISSUES_SHOWN)
    .map((i) => `- Line ${i.line}: "${i.comment}" (${i.reason})`)
    .join("\n");

  const overflow = issues.length > MAX_ISSUES_SHOWN ? `\n...and ${issues.length - MAX_ISSUES_SHOWN} more` : "";

  return `\n\n\u26a0\ufe0f **Comment Check**: Found ${issues.length} potentially unnecessary comment(s):\n${shown}${overflow}\n\nComments should explain WHY, not WHAT. Consider removing obvious comments.`;
}
