import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { log } from "./log.js";

/**
 * Locate the micode implementation to load.
 *
 * The adapter is a shim around the released plugin, and by default it loads the
 * published package from npm — that is what keeps `npm update micode` a
 * one-line upgrade and keeps `git fetch upstream` clean. But it also means the
 * repository's own `src/` is never executed, so a fix committed here is inert:
 * the prompts in `src/agents/*.ts` are only strings handed to the model, and
 * the model reads whatever copy the *loaded* bundle contains.
 *
 * That is not hypothetical. The array-form `spawn_agent` contract was corrected
 * in `src/agents/executor.ts`, `planner.ts` and `project-initializer.ts` while
 * the adapter still loaded the published bundle, which still taught the flat
 * form. Every one of those prompts then failed schema validation and spawned
 * nothing, so batched execution ran zero agents and said nothing about it.
 *
 * So: prefer a local build when one exists, and fall back to npm otherwise. An
 * installed clone (`npm install` with no build) behaves exactly as before, and
 * anyone running from a checkout gets their own source.
 */
const LOCAL_BUILD = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "dist", "index.js");

/**
 * `bun run build` in the repository root writes `dist/`. It is gitignored, so
 * its absence is the normal state of a fresh clone and must not be an error.
 */
export function localBuildPath() {
  return existsSync(LOCAL_BUILD) ? LOCAL_BUILD : null;
}

/**
 * Import the plugin, logging which copy won.
 *
 * The import is dynamic because the choice cannot be made until `setup` runs, and
 * `setup` is the first point with a log to say so in. Both candidates are
 * side-effect-free to import, so preferring the local build cannot double-load.
 */
export async function loadMicode() {
  const local = localBuildPath();
  if (local) {
    log("loading micode from the local build; run `bun run build` to refresh it", local);
    const module = await import(pathToFileURL(local).href);
    return module.OpenCodeConfigPlugin;
  }

  // No build present: the published package, which is the documented default.
  log("no local build found; loading micode from node_modules (run `bun run build` in the repo root to use local source)");
  const module = await import("micode");
  return module.OpenCodeConfigPlugin;
}

/** Exported for the test that asserts the resolution order. */
export { LOCAL_BUILD };