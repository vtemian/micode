// src/utils/process.ts
// Runtime-neutral process helpers. Bun's `which` and `spawn` are unavailable
// under Node and Electron, which host OpenCode Desktop, so these wrap the
// node: equivalents that both runtimes provide.

import { spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";

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

/**
 * Run a command to completion, collecting stdout and stderr.
 *
 * Rejects if the binary cannot be spawned, or if timeoutMs elapses first.
 */
export function runCommand(
  command: string,
  args: string[],
  options: { timeoutMs?: number } = {},
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      ...(options.timeoutMs === undefined ? {} : { timeout: options.timeoutMs, killSignal: TIMEOUT_SIGNAL }),
    });

    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (signal === TIMEOUT_SIGNAL && options.timeoutMs !== undefined) {
        reject(new Error(`${command} timed out after ${options.timeoutMs}ms`));
        return;
      }
      resolve({ stdout, stderr, exitCode: code ?? 0 });
    });
  });
}
