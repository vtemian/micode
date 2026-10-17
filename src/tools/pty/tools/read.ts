// src/tools/pty/tools/read.ts

import { z } from "zod";
import { defineTool, type MicodeTool } from "@/tools/define";
import type { PTYManager } from "@/tools/pty/manager";
import type { PTYSessionInfo, ReadResult, SearchResult } from "@/tools/pty/types";
import { config } from "@/utils/config";
import { extractErrorMessage } from "@/utils/errors";

const DESCRIPTION = `Reads output from a PTY session's buffer.

The PTY maintains a rolling buffer of output lines. Use offset and limit to paginate through the output, similar to reading a file.

Usage:
- \`id\`: The PTY session ID (from pty_spawn or pty_list)
- \`offset\`: Line number to start reading from (0-based, defaults to 0)
- \`limit\`: Number of lines to read (defaults to 500)
- \`pattern\`: Regex pattern to filter lines (optional)
- \`ignoreCase\`: Case-insensitive pattern matching (default: false)

Returns:
- Numbered lines of output (similar to cat -n format)
- Total line count in the buffer
- Indicator if more lines are available

The buffer stores up to PTY_MAX_BUFFER_LINES (default: 50000) lines. Older lines are discarded when the limit is reached.

Pattern Filtering:
- When \`pattern\` is set, lines are FILTERED FIRST using the regex, then offset/limit apply to the MATCHES
- Original line numbers are preserved so you can see where matches occurred in the buffer
- Supports full regex syntax (e.g., "error", "ERROR|WARN", "failed.*connection", etc.)
- If the pattern is invalid, an error message is returned explaining the issue
- If no lines match the pattern, a clear message indicates zero matches

Tips:
- To see the latest output, use a high offset or omit offset to read from the start
- To tail recent output, calculate offset as (totalLines - N) where N is how many recent lines you want
- Lines longer than 2000 characters are truncated
- Empty output may mean the process hasn't produced output yet

Examples:
- Read first 100 lines: offset=0, limit=100
- Read lines 500-600: offset=500, limit=100
- Read all available: omit both parameters
- Find errors: pattern="error", ignoreCase=true
- Find specific log levels: pattern="ERROR|WARN|FATAL"
- First 10 matches only: pattern="error", limit=10`;

const DEFAULT_LIMIT = config.limits.ptyDefaultReadLimit;
const MAX_LINE_LENGTH = config.limits.ptyMaxLineLength;
const LINE_NUMBER_PAD_WIDTH = 5;

function truncateLine(text: string): string {
  return text.length > MAX_LINE_LENGTH ? `${text.slice(0, MAX_LINE_LENGTH)}...` : text;
}

function formatLineNumber(num: number): string {
  return num.toString().padStart(LINE_NUMBER_PAD_WIDTH, "0");
}

function parseRegex(pattern: string, ignoreCase: boolean): RegExp {
  try {
    return new RegExp(pattern, ignoreCase ? "i" : "");
  } catch (e) {
    const error = extractErrorMessage(e);
    throw new Error(`Invalid regex pattern '${pattern}': ${error}`, { cause: e });
  }
}

function formatSearchOutput(
  id: string,
  session: PTYSessionInfo,
  pattern: string,
  result: SearchResult,
  offset: number,
): string {
  if (result.matches.length === 0) {
    return [
      `<pty_output id="${id}" status="${session.status}" pattern="${pattern}">`,
      `No lines matched the pattern '${pattern}'.`,
      `Total lines in buffer: ${result.totalLines}`,
      `</pty_output>`,
    ].join("\n");
  }

  const formattedLines = result.matches.map(
    (match) => `${formatLineNumber(match.lineNumber)}| ${truncateLine(match.text)}`,
  );

  const output = [`<pty_output id="${id}" status="${session.status}" pattern="${pattern}">`, ...formattedLines, ""];

  const paginationNote = result.hasMore
    ? `(${result.matches.length} of ${result.totalMatches} matches shown. Use offset=${offset + result.matches.length} to see more.)`
    : `(${result.totalMatches} match${result.totalMatches === 1 ? "" : "es"} from ${result.totalLines} total lines)`;
  output.push(paginationNote);
  output.push(`</pty_output>`);

  return output.join("\n");
}

function formatReadOutput(id: string, session: PTYSessionInfo, result: ReadResult): string {
  if (result.lines.length === 0) {
    return [
      `<pty_output id="${id}" status="${session.status}">`,
      `(No output available - buffer is empty)`,
      `Total lines: ${result.totalLines}`,
      `</pty_output>`,
    ].join("\n");
  }

  const formattedLines = result.lines.map(
    (line, index) => `${formatLineNumber(result.offset + index + 1)}| ${truncateLine(line)}`,
  );

  const output = [`<pty_output id="${id}" status="${session.status}">`, ...formattedLines, ""];

  const paginationNote = result.hasMore
    ? `(Buffer has more lines. Use offset=${result.offset + result.lines.length} to read beyond line ${result.offset + result.lines.length})`
    : `(End of buffer - total ${result.totalLines} lines)`;
  output.push(paginationNote);
  output.push(`</pty_output>`);

  return output.join("\n");
}

export function createPtyReadTool(manager: PTYManager): MicodeTool {
  return defineTool({
    description: DESCRIPTION,
    args: {
      id: z.string().describe("The PTY session ID (e.g., pty_a1b2c3d4)"),
      offset: z.number().optional().describe("Line number to start reading from (0-based, defaults to 0)"),
      limit: z.number().optional().describe("Number of lines to read (defaults to 500)"),
      pattern: z.string().optional().describe("Regex pattern to filter lines"),
      ignoreCase: z.boolean().optional().describe("Case-insensitive pattern matching (default: false)"),
    },
    execute: async (args) => {
      const session = manager.get(args.id);
      if (!session) {
        throw new Error(`PTY session '${args.id}' not found. Use pty_list to see active sessions.`);
      }

      const offset = Math.max(0, args.offset ?? 0);
      const limit = args.limit ?? DEFAULT_LIMIT;

      if (args.pattern) {
        const regex = parseRegex(args.pattern, args.ignoreCase ?? false);
        const searchResult = manager.search(args.id, regex, offset, limit);
        if (!searchResult) {
          throw new Error(`PTY session '${args.id}' not found.`);
        }
        return formatSearchOutput(args.id, session, args.pattern, searchResult, offset);
      }

      const readResult = manager.read(args.id, offset, limit);
      if (!readResult) {
        throw new Error(`PTY session '${args.id}' not found.`);
      }
      return formatReadOutput(args.id, session, readResult);
    },
  });
}
