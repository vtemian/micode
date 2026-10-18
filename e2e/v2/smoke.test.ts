import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..", "..");
const PORT = 44199;
const BOOT_TIMEOUT_MS = 120_000;
const READY_TIMEOUT_MS = 30_000;
const POLL_MS = 200;

interface Server {
  proc: ReturnType<typeof Bun.spawn>;
  log: string[];
  password: string;
  project: string;
}

/** Pushes complete lines only; a chunk boundary must not split the password line. */
async function readLines(stream: ReadableStream<Uint8Array>, into: string[]): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let rest = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) {
      if (rest) into.push(rest);
      return;
    }
    const lines = (rest + decoder.decode(value, { stream: true })).split("\n");
    rest = lines.pop() ?? "";
    into.push(...lines);
  }
}

async function waitFor(pred: () => string | undefined, timeoutMs: number): Promise<string> {
  const start = Date.now();
  for (;;) {
    const hit = pred();
    if (hit) return hit;
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for server line`);
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

async function startServer(): Promise<Server> {
  const home = await mkdtemp(join(tmpdir(), "micode-v2-"));
  await mkdir(join(home, ".config", "opencode"), { recursive: true });
  // v2 config: `plugins` (plural) and a directory entry resolved through the root index.js.
  await writeFile(
    join(home, ".config", "opencode", "opencode.jsonc"),
    JSON.stringify({ plugins: [REPO_ROOT], share: "disabled" }),
  );
  // The harness image has no npx, so the bundled context7 MCP server cannot start; keep it off like the v1 tier.
  await writeFile(join(home, ".config", "opencode", "micode.json"), JSON.stringify({ features: { context7: false } }));
  const project = await mkdtemp(join(tmpdir(), "micode-v2-project-"));
  const log: string[] = [];
  const proc = Bun.spawn(["opencode", "serve", "--port", String(PORT), "--print-logs", "--log-level", "info"], {
    cwd: project,
    env: {
      PATH: process.env.PATH ?? "",
      HOME: home,
      XDG_CONFIG_HOME: join(home, ".config"),
      OPENCODE_DISABLE_AUTOUPDATE: "1",
    },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  void readLines(proc.stdout, log);
  void readLines(proc.stderr, log);
  const line = await waitFor(() => log.find((l) => l.includes("server password")), BOOT_TIMEOUT_MS);
  // The password is the last whitespace-delimited token and may contain underscores.
  const password = line.trim().split(/\s+/).pop() ?? "";
  return { proc, log, password, project };
}

describe("micode on OpenCode 2", () => {
  let server: Server;
  beforeAll(async () => {
    server = await startServer();
    // Poll until the API answers rather than sleeping a fixed interval.
    await waitFor(
      () => (server.log.some((l) => /listening|server password/i.test(l)) ? "ready" : undefined),
      READY_TIMEOUT_MS,
    );
    const started = Date.now();
    for (;;) {
      const res = await fetch(`http://127.0.0.1:${PORT}/api/agent`, {
        headers: { Authorization: `Basic ${btoa(`opencode:${server.password}`)}` },
      }).catch(() => undefined);
      if (res?.ok) break;
      if (Date.now() - started > READY_TIMEOUT_MS) {
        throw new Error(`server never became ready (last status ${res?.status ?? "no response"})`);
      }
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
  });
  afterAll(() => {
    server?.proc.kill();
  });

  /** Responses are wrapped as `{ location, data }`. */
  async function api(path: string): Promise<unknown> {
    const res = await fetch(`http://127.0.0.1:${PORT}${path}`, {
      headers: { Authorization: `Basic ${btoa(`opencode:${server.password}`)}` },
    });
    expect(res.ok).toBe(true);
    const body = (await res.json()) as { data?: unknown };
    return body.data;
  }

  async function agentNames(): Promise<string[]> {
    const agents = (await api(`/api/agent?directory=${encodeURIComponent(server.project)}`)) as {
      id?: string;
      name?: string;
    }[];
    return agents.map((a) => a.name ?? a.id ?? "");
  }

  it("registers the micode agents", async () => {
    // Plugins load lazily on the first request for a directory; poll until setup has run.
    let names: string[] = [];
    const started = Date.now();
    while (!names.includes("commander")) {
      names = await agentNames();
      if (Date.now() - started > READY_TIMEOUT_MS) break;
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
    expect(names).toEqual(expect.arrayContaining(["commander", "executor", "probe", "mm-constraint-reviewer"]));
  });

  it("registers the micode commands", async () => {
    const commands = (await api(`/api/command?directory=${encodeURIComponent(server.project)}`)) as { name?: string }[];
    expect(commands.map((c) => c.name)).toEqual(expect.arrayContaining(["init", "mindmodel", "ledger", "search"]));
  });

  it("loads without a plugin error", () => {
    // Runs after the directory-scoped requests above, so the plugin has been set up by now.
    const bad = server.log.filter((l) => /failed to load|LoadError|PluginModule|level=ERROR/i.test(l));
    expect(bad).toEqual([]);
  });

  it("maps the commander agent onto the v2 record", async () => {
    const agents = (await api(`/api/agent?directory=${encodeURIComponent(server.project)}`)) as Record<string, any>[];
    const commander = agents.find((a) => (a.name ?? a.id) === "commander");
    expect(commander?.mode).toBe("primary");
    expect(typeof commander?.system).toBe("string");
    // OpenCode 2 never applies request.body; generation settings go through the context hook instead.
    expect(commander?.request?.body?.temperature).toBeUndefined();
    // OpenCode 2 names the shell action "shell"; the v1 "bash" permission must have been translated.
    expect(commander?.permissions).toEqual(
      expect.arrayContaining([{ action: "shell", resource: "*", effect: "allow" }]),
    );
  });
});
