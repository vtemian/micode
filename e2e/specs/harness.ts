/**
 * Shared plumbing for the scripted end-to-end tier.
 *
 * Everything except the model is real: the opencode runtime, the built plugin,
 * the tool calls and the fixture on disk. The model is a scripted stub so a
 * run is deterministic, free and fast. The live-model tier (tests/e2e) keeps
 * its own harness: it drains real paid sessions, this one drives a stub.
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dirname, "..", "..");
const FIXTURE_SOURCE = join(REPO_ROOT, "tests", "e2e", "fixture");
const PLUGIN_PATH = join(REPO_ROOT, "dist", "index.js");
const STUB_SERVER = join(import.meta.dirname, "..", "stub-provider", "server.ts");

const DEFAULT_STUB_PORT = 8787;
const READY_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 100;
const OUTPUT_TAIL_CHARS = 2000;

export interface StubHandle {
  readonly port: number;
  stop: () => void;
}

/** One completed opencode session, plus the directories it owned. */
export interface Run {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly timedOut: boolean;
  readonly projectDir: string;
  readonly homeDir: string;
}

export function stubPort(): number {
  return Number(process.env.STUB_PORT ?? DEFAULT_STUB_PORT);
}

export async function waitUntil(check: () => Promise<boolean> | boolean, label: string): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await check()) return;
    await Bun.sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

export async function startStub(scriptPath: string): Promise<StubHandle> {
  const port = stubPort();
  const proc = Bun.spawn(["bun", STUB_SERVER], {
    env: { ...process.env, STUB_SCRIPT: scriptPath, STUB_PORT: String(port) },
    stdout: "inherit",
    stderr: "inherit",
  });

  await waitUntil(async () => {
    try {
      return (await fetch(`http://127.0.0.1:${port}/health`)).ok;
    } catch {
      return false;
    }
  }, "stub provider");

  return { port, stop: () => proc.kill() };
}

function requirePath(path: string, remedy: string): void {
  if (!existsSync(path)) throw new Error(`Missing ${path}. ${remedy}`);
}

/** A fresh copy of the shared fixture, so specs cannot see each other's writes. */
export function createProject(): string {
  requirePath(FIXTURE_SOURCE, "The e2e fixture project belongs at tests/e2e/fixture.");
  const dir = mkdtempSync(join(tmpdir(), "micode-e2e-project-"));
  cpSync(FIXTURE_SOURCE, dir, { recursive: true });
  return dir;
}

/**
 * opencode derives every XDG path from os.homedir(), which honours $HOME, so a
 * temp HOME isolates config, auth, session DB, cache and logs in one move.
 */
export function createHome(): string {
  return mkdtempSync(join(tmpdir(), "micode-e2e-home-"));
}

export interface StubConfigOptions {
  /** Replaces the default stub provider block, e.g. to pose as a registry-backed provider. */
  readonly provider?: Record<string, unknown>;
  /** Replaces the default "stub/stub-model" session model. */
  readonly model?: string;
  /** Extra keys merged into micode.json, e.g. per-agent overrides. */
  readonly micode?: Record<string, unknown>;
}

/**
 * The stub provider replaces the model; the plugin array loads the built
 * plugin by absolute path. micode.json disables the bundled context7 server:
 * it would npx-download on every cold HOME for no benefit under a stub.
 */
export function writeStubConfig(home: string, options: StubConfigOptions = {}): void {
  const configDir = join(home, ".config", "opencode");
  mkdirSync(configDir, { recursive: true });

  const provider = options.provider ?? {
    stub: {
      npm: "@ai-sdk/openai-compatible",
      name: "Stub Provider",
      options: { baseURL: `http://127.0.0.1:${stubPort()}/v1`, apiKey: "stub-key" },
      models: { "stub-model": { name: "Stub Model" } },
    },
  };

  const config = {
    $schema: "https://opencode.ai/config.json",
    model: options.model ?? "stub/stub-model",
    small_model: options.model ?? "stub/stub-model",
    provider,
    plugin: [PLUGIN_PATH],
    share: "disabled",
    compaction: { auto: false },
  };
  writeFileSync(join(configDir, "opencode.json"), JSON.stringify(config, null, 2));

  const micodeConfig = { features: { context7: false }, ...options.micode };
  writeFileSync(join(configDir, "micode.json"), JSON.stringify(micodeConfig, null, 2));
}

/**
 * An explicit allowlist, never ...process.env: an ambient OPENAI_API_KEY
 * silently enables extra providers and changes what the run can reach.
 */
function isolatedEnv(home: string): Record<string, string> {
  return {
    PATH: process.env.PATH ?? "",
    HOME: home,
    OPENCODE_DISABLE_AUTOUPDATE: "1",
    OPENCODE_DISABLE_EXTERNAL_SKILLS: "1",
    OPENCODE_DISABLE_LSP_DOWNLOAD: "1",
  };
}

/**
 * Runs a plugin command to completion. The command's agent runs in a child
 * session (opencode's task-tool expansion), and the primary session's own
 * model turn after it is served "Script exhausted." by the stub, which ends
 * the run. opencode then exits on its own, so draining to exit captures the
 * artifacts written late. stdin is ignored: opencode blocks reading stdin to
 * EOF when it is not a TTY and the run would hang before the stub answers.
 */
export async function runCommand(
  command: string,
  message: string,
  timeoutMs: number,
  options: StubConfigOptions = {},
): Promise<Run> {
  return run(["--command", command], message, timeoutMs, options);
}

/** A plain prompt run: the default primary agent (commander) answers. */
export async function runPrompt(message: string, timeoutMs: number, options: StubConfigOptions = {}): Promise<Run> {
  return run([], message, timeoutMs, options);
}

/** Runs with an explicit --agent. Note: subagent-mode agents silently fall back to the primary one. */
export async function runAgent(
  agent: string,
  message: string,
  timeoutMs: number,
  options: StubConfigOptions = {},
): Promise<Run> {
  return run(["--agent", agent], message, timeoutMs, options);
}

async function run(
  modeArgs: readonly string[],
  message: string,
  timeoutMs: number,
  options: StubConfigOptions,
): Promise<Run> {
  const projectDir = createProject();
  const homeDir = createHome();
  writeStubConfig(homeDir, options);

  const proc = Bun.spawn(
    ["opencode", "run", ...modeArgs, "--format", "json", "--print-logs", "--log-level", "DEBUG", "--auto", message],
    { cwd: projectDir, env: isolatedEnv(homeDir), stdin: "ignore", stdout: "pipe", stderr: "pipe" },
  );

  let killedByTimer = false;
  const timer = setTimeout(() => {
    killedByTimer = true;
    proc.kill();
  }, timeoutMs);

  let drained: [string, string, number];
  try {
    drained = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  } finally {
    clearTimeout(timer);
  }
  const [stdout, stderr, exitCode] = drained;

  // The kill must have preceded the drain resolving: a timer that fires while
  // a healthy process is already exiting never marks the run as timed out.
  return { stdout, stderr, exitCode, timedOut: killedByTimer, projectDir, homeDir };
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
