// src/utils/process.ts
// Runtime-neutral process helpers. Bun's `which` and `spawn` are unavailable
// under Node and Electron, which host OpenCode Desktop, so these wrap the
// node: equivalents that both runtimes provide.

import { spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";
import type { Readable } from "node:stream";

const WINDOWS_DEFAULT_EXTENSIONS = ".COM;.EXE;.BAT;.CMD";
const TIMEOUT_SIGNAL = "SIGTERM";

export interface CommandResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

function isExecutable(candidate: string): boolean {
  try {
    accessSync(candidate, constants.X_OK);
    return true;
  } catch {
    // Not present or not executable at this location; keep scanning PATH.
    return false;
  }
}

function executableExtensions(): string[] {
  if (process.platform !== "win32") return [""];
  return (process.env.PATHEXT ?? WINDOWS_DEFAULT_EXTENSIONS).split(";").filter(Boolean);
}

function findInDirectory(dir: string, name: string): string | null {
  for (const extension of executableExtensions()) {
    const candidate = join(dir, `${name}${extension}`);
    if (isExecutable(candidate)) return candidate;
  }
  return null;
}

/**
 * Resolve an executable through PATH, returning its full path or null.
 */
export function findExecutable(name: string): string | null {
  const searchPaths = (process.env.PATH ?? "").split(delimiter).filter(Boolean);

  for (const dir of searchPaths) {
    const found = findInDirectory(dir, name);
    if (found) return found;
  }
  return null;
}

function collect(stream: Readable, append: (chunk: string) => void): void {
  stream.setEncoding("utf8");
  stream.on("data", append);
}

/**
 * Run a command to completion, collecting stdout and stderr.
 *
 * Rejects if the binary cannot be spawned, or if timeoutMs elapses first.
 *
 * The timeout is enforced with an explicit timer rather than the spawn option
 * of the same name, which Bun and Node do not honour identically.
 */
export function runCommand(
  command: string,
  args: string[],
  options: { timeoutMs?: number } = {},
): Promise<CommandResult> {
  const { timeoutMs } = options;

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    // Settle from the timer rather than waiting for "close": a killed shell can
    // leave a grandchild holding the stdio pipes open, which delays that event
    // for as long as the original command would have run.
    const timer =
      timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            timedOut = true;
            child.kill(TIMEOUT_SIGNAL);
            reject(new Error(`${command} timed out after ${timeoutMs}ms`));
          }, timeoutMs);

    collect(child.stdout, (chunk) => {
      stdout += chunk;
    });
    collect(child.stderr, (chunk) => {
      stderr += chunk;
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) return;
      resolve({ stdout, stderr, exitCode: code ?? 0 });
    });
  });
}
