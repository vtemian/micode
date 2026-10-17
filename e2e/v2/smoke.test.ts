import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..", "..");
const PORT = 44199;
const BOOT_TIMEOUT_MS = 120_000;
const SETTLE_MS = 3000;
const POLL_MS = 200;

interface Server {
  proc: ReturnType<typeof Bun.spawn>;
  log: string[];
  password: string;
  project: string;
}

async function readLines(stream: ReadableStream<Uint8Array>, into: string[]): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    into.push(...decoder.decode(value).split("\n"));
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
  const password =
    line
      .split("server password")
      .pop()
      ?.replace(/[^A-Za-z0-9-]/g, "") ?? "";
  return { proc, log, password, project };
}

describe("micode on OpenCode 2", () => {
  let server: Server;
  beforeAll(async () => {
    server = await startServer();
    await new Promise((r) => setTimeout(r, SETTLE_MS));
  });
  afterAll(() => {
    server?.proc.kill();
  });

  async function api(path: string): Promise<unknown> {
    const res = await fetch(`http://127.0.0.1:${PORT}${path}`, {
      headers: { Authorization: `Basic ${btoa(`opencode:${server.password}`)}` },
    });
    expect(res.ok).toBe(true);
    return res.json();
  }

  it("loads without a plugin error", () => {
    const bad = server.log.filter(
      (l) => /failed to load|LoadError/i.test(l) || (/micode/i.test(l) && /error/i.test(l)),
    );
    expect(bad).toEqual([]);
  });

  it("registers the micode agents", async () => {
    const agents = (await api(`/api/agent?directory=${encodeURIComponent(server.project)}`)) as {
      id?: string;
      name?: string;
    }[];
    const names = agents.map((a) => a.name ?? a.id);
    expect(names).toEqual(expect.arrayContaining(["commander", "executor", "probe", "mm-constraint-reviewer"]));
  });

  it("prints the permission lines seen by the host (informational)", () => {
    // The plugin allows edit/bash/webfetch/external_directory by action name. If the v2 host uses other
    // action names they show up here once a session runs.
    console.log(server.log.filter((l) => l.includes("permission")).join("\n"));
  });
});
