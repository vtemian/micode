// src/tools/pty/pty-loader.ts
// Resolves bun-pty native library path and loads bun-pty with graceful degradation.
//
// bun-pty's resolveLibPath() checks BUN_PTY_LIB env var first, then hardcoded paths
// relative to import.meta.url. When micode is installed as an OpenCode plugin,
// the library ends up in .opencode/node_modules/bun-pty/... which isn't in the
// hardcoded search paths. We fix this by probing likely locations and setting
// BUN_PTY_LIB before the dynamic import.
//
// See: https://github.com/vtemian/micode/issues/20
// See: https://github.com/anomalyco/opencode/issues/10556

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

import { log } from "../../utils/logger";

type BunPtyModule = typeof import("bun-pty");

let cachedModule: BunPtyModule | null = null;
let loadAttempted = false;
let loadError: string | null = null;

/**
 * Probe additional paths where the bun-pty native library might live,
 * beyond what bun-pty checks itself. Sets BUN_PTY_LIB if found.
 */
function probeBunPtyLib(): void {
  // If already set by user, respect it
  if (process.env.BUN_PTY_LIB) return;

  const platform = process.platform;
  const arch = process.arch;

  const filenames =
    platform === "darwin"
      ? arch === "arm64"
        ? ["librust_pty_arm64.dylib", "librust_pty.dylib"]
        : ["librust_pty.dylib"]
      : platform === "win32"
        ? ["rust_pty.dll"]
        : arch === "arm64"
          ? ["librust_pty_arm64.so", "librust_pty.so"]
          : ["librust_pty.so"];

  const cwd = process.cwd();

  // Paths that bun-pty does NOT check but where the lib may exist
  // when installed as an OpenCode plugin dependency
  const additionalBasePaths = [
    // .opencode/node_modules/bun-pty/... (plugin installed via .opencode/package.json)
    join(cwd, ".opencode", "node_modules", "bun-pty", "rust-pty", "target", "release"),
    // .micode/node_modules/bun-pty/... (if micode has its own node_modules)
    join(cwd, ".micode", "node_modules", "bun-pty", "rust-pty", "target", "release"),
  ];

  // Also try resolving from require.resolve if available
  try {
    const bunPtyMain = require.resolve("bun-pty");
    if (bunPtyMain) {
      // require.resolve gives us something like .../node_modules/bun-pty/src/index.ts
      // Go up to the bun-pty package root
      const pkgDir = dirname(dirname(bunPtyMain));
      additionalBasePaths.unshift(join(pkgDir, "rust-pty", "target", "release"));
    }
  } catch {
    // require.resolve may fail in some environments
  }

  for (const basePath of additionalBasePaths) {
    for (const filename of filenames) {
      const candidate = join(basePath, filename);
      if (existsSync(candidate)) {
        process.env.BUN_PTY_LIB = candidate;
        log.info("pty.loader", `Auto-resolved BUN_PTY_LIB=${candidate}`);
        return;
      }
    }
  }
}

/**
 * Dynamically load bun-pty with graceful degradation.
 * Sets BUN_PTY_LIB env var before import to fix path resolution
 * in OpenCode plugin environments.
 *
 * Returns null if bun-pty cannot be loaded (native library missing, etc.)
 */
export async function loadBunPty(): Promise<BunPtyModule | null> {
  if (loadAttempted) return cachedModule;
  loadAttempted = true;

  // Probe and set BUN_PTY_LIB before importing
  probeBunPtyLib();

  try {
    cachedModule = await import("bun-pty");
    log.info("pty.loader", "bun-pty loaded successfully");
    return cachedModule;
  } catch (error) {
    loadError = error instanceof Error ? error.message : String(error);
    // Extract just the first line for a cleaner warning
    const firstLine = loadError.split("\n")[0];
    log.warn("pty.loader", `bun-pty unavailable: ${firstLine}`);
    log.warn("pty.loader", "PTY tools will be disabled. Set BUN_PTY_LIB env var to the native library path to fix.");
    cachedModule = null;
    return null;
  }
}

/**
 * Check if bun-pty is available (must call loadBunPty first).
 */
export function isBunPtyAvailable(): boolean {
  return cachedModule !== null;
}

/**
 * Get the load error message, if any.
 */
export function getBunPtyLoadError(): string | null {
  return loadError;
}
