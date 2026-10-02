/**
 * The adapter must load this repository's `src/`, not the published bundle.
 *
 * Agent prompts are data, not code: `src/agents/*.ts` holds strings that get
 * handed to a model, and the model obeys whichever copy the *loaded* bundle
 * carries. So a prompt fixed in `src/` and shipped from `node_modules` is a
 * prompt that changes nothing, and the failure is silent — a batched spawn that
 * uses the stale call shape fails schema validation and spawns zero agents.
 *
 * That is exactly what happened: the array-form `spawn_agent` contract was
 * corrected in `src/agents/executor.ts` while the adapter loaded the published
 * `dist/index.js`, which still taught the flat form. The fix was committed, the
 * contract tests passed against `src/`, and running agents still spawned
 * nothing.
 *
 * So the resolution order is the thing under test. These assertions fail if the
 * local build stops winning, or if it silently stops being consulted at all.
 *
 * Run: node test/local-build.test.js
 */
import { existsSync, readFileSync } from "node:fs";
import { LOCAL_BUILD, localBuildPath } from "../lib/micode.js";
import { check, report } from "./assert.js";

// --- A local build wins over node_modules -------------------------------------

check(
  "a local build is found",
  localBuildPath() === LOCAL_BUILD,
  `no build at ${LOCAL_BUILD}; run \`bun run build\` in the repo root`,
);

check(
  "it is the bundle, not a directory",
  existsSync(LOCAL_BUILD) && !existsSync(`${LOCAL_BUILD}/`),
  `${LOCAL_BUILD} is not a file`,
);

// --- And it is the *current* bundle -------------------------------------------

const bundle = readFileSync(LOCAL_BUILD, "utf-8");

// The stale prompt taught the flat call. The current one forbids it by name, so
// the bundle legitimately still contains the string — what matters is that every
// occurrence is a prohibition and none is an instruction.
const FLAT = "Spawns a subagent synchronously";
check(
  "the loaded bundle does not instruct the flat spawn_agent call",
  !bundle.includes(FLAT),
  `the loaded bundle still teaches \`spawn_agent(agent, prompt, description)\``,
);

check(
  "the loaded bundle teaches the agents array",
  bundle.includes("the array IS the parallelism"),
  "no array-form instruction found; was dist/ built from current src/?",
);

// --- The published bundle is the one that was wrong ---------------------------
// Not a regression test for the fallback path, just a record of which copy the
// bug lived in: if node_modules ever stops disagreeing, this stops applying.
const published = "node_modules/micode/dist/index.js";
if (existsSync(published)) {
  const stale = readFileSync(published, "utf-8").includes(FLAT);
  check(
    "node_modules still carries the stale prompt (so the local build matters)",
    stale,
    "node_modules was updated; re-check whether the local build is still the right choice",
  );
}

report();
process.exit(process.exitCode ?? 0);