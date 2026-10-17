import { readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { z } from "zod";
import type { Workspace } from "@/host/port";
import { extractErrorMessage } from "@/utils/errors";
import { defineTool, type MicodeTool } from "./define";

interface FileResult {
  readonly path: string;
  readonly content?: string;
  readonly error?: string;
}

function truncateContent(content: string, maxLines: number): string {
  const lines = content.split("\n");
  if (lines.length <= maxLines) return content;
  return `${lines.slice(0, maxLines).join("\n")}\n... (truncated, ${lines.length - maxLines} more lines)`;
}

async function readSingleFile(filePath: string, baseDir: string, maxLines?: number): Promise<FileResult> {
  const fullPath = isAbsolute(filePath) ? filePath : join(baseDir, filePath);

  try {
    let content = await readFile(fullPath, "utf-8");
    if (maxLines && maxLines > 0) {
      content = truncateContent(content, maxLines);
    }
    return { path: filePath, content };
  } catch (error) {
    const msg = extractErrorMessage(error);
    return { path: filePath, error: msg };
  }
}

function formatResults(results: FileResult[], totalFiles: number): string {
  const output: string[] = [`# Batch Read (${totalFiles} files)\n`];

  for (const result of results) {
    if (result.error) {
      output.push(`## ${result.path}\n\n**Error**: ${result.error}\n`);
    } else {
      output.push(`## ${result.path}\n\n\`\`\`\n${result.content}\n\`\`\`\n`);
    }
  }

  return output.join("\n");
}

export function createBatchReadTool(workspace: Workspace): MicodeTool {
  return defineTool({
    description: `Read multiple files in parallel. Much faster than reading files one at a time.
Use this when you need to read 2+ files - all reads happen concurrently via Promise.all.

Example: batch_read({paths: ["src/index.ts", "src/utils.ts", "package.json"]})

Returns content for each file, or error message if file doesn't exist.`,
    args: {
      paths: z.array(z.string()).describe("Array of file paths to read (relative to project root or absolute)"),
      maxLines: z.number().optional().describe("Optional: limit each file to first N lines (default: no limit)"),
    },
    execute: async (args) => {
      const { paths, maxLines } = args;

      if (!paths || paths.length === 0) {
        return "## batch_read Failed\n\nNo paths specified";
      }

      const results = await Promise.all(paths.map((p) => readSingleFile(p, workspace.directory, maxLines)));
      return formatResults(results, paths.length);
    },
  });
}
