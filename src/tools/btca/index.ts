import { tool } from "@opencode-ai/plugin/tool";
import { config } from "@/utils/config";
import { extractErrorMessage } from "@/utils/errors";
import { findExecutable, runCommand } from "@/utils/process";

/**
 * Check if btca CLI is available on the system.
 * Returns installation instructions if not found.
 */
export async function checkBtcaAvailable(): Promise<{ available: boolean; message?: string }> {
  const btcaPath = findExecutable("btca");
  if (btcaPath) {
    return { available: true };
  }
  return {
    available: false,
    message:
      "btca CLI not found. Library source code search will not work.\n" +
      "Install from: https://github.com/davis7dotsh/better-context\n" +
      "  bun add -g btca",
  };
}

async function runBtca(args: string[]): Promise<{ output: string; error?: string }> {
  try {
    const { stdout, stderr, exitCode } = await runCommand("btca", args, { timeoutMs: config.timeouts.btcaMs });

    if (exitCode !== 0) {
      const errorMsg = stderr.trim() || `Exit code ${exitCode}`;
      return { output: "", error: errorMsg };
    }

    return { output: stdout.trim() };
  } catch (e) {
    const msg = extractErrorMessage(e);
    if (msg.includes("ENOENT")) {
      return {
        output: "",
        error:
          "btca CLI not found. Install from: https://github.com/davis7dotsh/better-context\n" + "  bun add -g btca",
      };
    }
    return { output: "", error: msg };
  }
}

export const btca_ask = tool({
  description:
    "Ask questions about library/framework source code using btca. " +
    "Clones repos locally and searches source code to answer questions. " +
    "Use for understanding library internals, finding implementation details, or debugging.",
  args: {
    tech: tool.schema.string().describe("Resource name configured in btca (e.g., 'react', 'express')"),
    question: tool.schema.string().describe("Question to ask about the library source code"),
  },
  execute: async (args) => {
    const btcaOutput = await runBtca(["ask", "-t", args.tech, "-q", args.question]);

    if (btcaOutput.error) {
      return `Error: ${btcaOutput.error}`;
    }

    return btcaOutput.output || "No answer found";
  },
});
