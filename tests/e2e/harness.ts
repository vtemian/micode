// tests/e2e/harness.ts
// Drives a real opencode session against a real model. Everything is real:
// the runtime, the built plugin, the model, and the fixture on disk.
import { cpSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dirname, "..", "..");
const FIXTURE_SOURCE = join(import.meta.dirname, "fixture");
const PLUGIN_PATH = join(REPO_ROOT, "dist", "index.js");

const FREE_MODEL = "opencode/deepseek-v4-flash-free";
const POLL_INTERVAL_MS = 200;
const OUTPUT_TAIL_CHARS = 2000;
const STEP_FINISH = "step_finish";

/** One completed opencode session, plus the directories it owned. */
export interface Run {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly projectDir: string;
  readonly homeDir: string;
  readonly timedOut: boolean;
}

/** One line of `--format json` output. The envelope carries the part. */
interface RunEvent {
  readonly type?: string;
  readonly part?: { readonly cost?: number };
}

function requirePath(path: string, remedy: string): void {
  if (!existsSync(path)) throw new Error(`Missing ${path}. ${remedy}`);
}

/** Paid models are opt-in; the default tier costs nothing and needs no secret. */
export function e2eModel(): string {
  return process.env.MICODE_E2E_MODEL ?? FREE_MODEL;
}

export async function waitUntil(
  check: () => boolean | Promise<boolean>,
  label: string,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await Bun.sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for ${label}`);
}

/** A fresh copy of the fixture, so specs cannot see each other's writes. */
export function createProject(): string {
  requirePath(FIXTURE_SOURCE, "The e2e fixture project belongs at tests/e2e/fixture.");
  const dir = mkdtempSync(join(tmpdir(), "micode-e2e-project-"));
  cpSync(FIXTURE_SOURCE, dir, { recursive: true });
  return dir;
}

/**
 * opencode derives every XDG path from os.homedir(), which honours $HOME, so a
 * temp HOME isolates config, auth, session DB, cache and logs in one move.
 * OPENCODE_CONFIG_DIR does NOT do this: it appends to the scan list.
 */
export function createHome(): string {
  return mkdtempSync(join(tmpdir(), "micode-e2e-home-"));
}

/**
 * Written into the isolated HOME rather than the project, because micode
 * resolves its agents' model through loadDefaultModel(), which reads only the
 * global config dir. A project-level opencode.json is enough for opencode
 * itself but leaves micode's agents on their hardcoded default.
 */
export function writeConfig(homeDir: string, model: string): void {
  const configDir = join(homeDir, ".config", "opencode");
  mkdirSync(configDir, { recursive: true });

  const config = {
    $schema: "https://opencode.ai/config.json",
    model,
    small_model: model,
    plugin: [PLUGIN_PATH],
    share: "disabled",
    compaction: { auto: false },
  };
  writeFileSync(join(configDir, "opencode.json"), JSON.stringify(config, null, 2));
}

/**
 * An explicit allowlist, never ...process.env: an ambient OPENAI_API_KEY
 * silently enables 48 extra models and changes what the run can reach.
 */
function isolatedEnv(home: string): Record<string, string> {
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "",
    HOME: home,
    OPENCODE_DISABLE_AUTOUPDATE: "1",
    OPENCODE_DISABLE_EXTERNAL_SKILLS: "1",
    OPENCODE_DISABLE_LSP_DOWNLOAD: "1",
  };
  // Paid models need credentials; free ones authenticate as "public".
  if (process.env.MICODE_E2E_AUTH_CONTENT) {
    env.OPENCODE_AUTH_CONTENT = process.env.MICODE_E2E_AUTH_CONTENT;
  }
  return env;
}

// --pure is deliberately absent: it disables every external plugin, micode included.
function opencodeArgs(command: string, message: string, model: string): string[] {
  return [
    "opencode",
    "run",
    "--command",
    command,
    "--format",
    "json",
    "--print-logs",
    "--log-level",
    "DEBUG",
    "--auto",
    "-m",
    model,
    message,
  ];
}

export async function runCommand(
  projectDir: string,
  command: string,
  message: string,
  timeoutMs: number,
): Promise<Run> {
  const homeDir = createHome();
  const model = e2eModel();
  writeConfig(homeDir, model);

  const proc = Bun.spawn(opencodeArgs(command, message, model), {
    cwd: projectDir,
    env: isolatedEnv(homeDir),
    // opencode blocks reading stdin to EOF when it is not a TTY. Leaving this
    // inherited hangs the run forever, before the model is ever contacted.
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, timeoutMs);

  // Both streams are drained to completion instead of being stopped at a marker:
  // opencode exits on its own, and the artifacts under test are written late, so
  // an early kill would truncate exactly what the specs assert on.
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  clearTimeout(timer);

  return { stdout, stderr, exitCode, projectDir, homeDir, timedOut };
}

/** Total cost across every step_finish event. Zero proves the run stayed free. */
export function totalCost(run: Run): number {
  let cost = 0;
  for (const line of run.stdout.split("\n")) {
    if (!line.trim()) continue;
    try {
      const event: RunEvent = JSON.parse(line);
      if (event.type === STEP_FINISH && typeof event.part?.cost === "number") cost += event.part.cost;
    } catch {
      // Non-JSON lines are not events; the stream is NDJSON but tolerant.
    }
  }
  return cost;
}

export function describeRun(run: Run): string {
  const outcome = run.timedOut ? `exit=${run.exitCode} (timed out)` : `exit=${run.exitCode}`;
  return [
    outcome,
    "--- stdout tail ---",
    run.stdout.slice(-OUTPUT_TAIL_CHARS),
    "--- stderr tail ---",
    run.stderr.slice(-OUTPUT_TAIL_CHARS),
  ].join("\n");
}

export function ensureBuilt(): void {
  requirePath(PLUGIN_PATH, "Run: bun run build");
}
