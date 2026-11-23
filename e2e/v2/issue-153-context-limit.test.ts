import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { waitUntil } from "../specs/harness";
import { createStubProvider } from "../stub-provider/server";

const ROOT = join(import.meta.dir, "..", "..");
const SCRIPT = join(ROOT, "e2e", "scripts", "issue-153-context-limit.json");
const PROVIDER = "micode-e2e";
const MODEL = "stub-model";
const API_KEY = "MICODE_E2E_API_KEY";
const CONTEXT_LIMIT = 1_000_000;
const COMPACTION_THRESHOLD = 0.9;
const PORT = 44200;
const TEST_TIMEOUT_MS = 90_000;

async function configure(home: string, port: number, prefix: string): Promise<void> {
  const directory = join(home, ".config", "opencode");
  await mkdir(directory, { recursive: true });
  const config = {
    plugins: [ROOT],
    model: `${PROVIDER}/${MODEL}`,
    providers: {
      [PROVIDER]: {
        name: "Scripted provider",
        env: [API_KEY],
        package: "@opencode/ai/providers/openai-compatible",
        settings: { baseURL: `http://127.0.0.1:${port}/v1` },
        models: { [MODEL]: { name: "Stub", limit: { context: CONTEXT_LIMIT, output: 8_000 } } },
      },
    },
    compaction: { auto: false },
  };
  await writeFile(join(directory, "opencode.jsonc"), `${prefix}${JSON.stringify(config)}`);
  await writeFile(
    join(directory, "micode.json"),
    JSON.stringify({ features: { context7: false }, compactionThreshold: COMPACTION_THRESHOLD }),
  );
}

async function capture(stream: ReadableStream<Uint8Array>, append: (text: string) => void): Promise<void> {
  const decoder = new TextDecoder();
  for await (const chunk of stream) append(decoder.decode(chunk, { stream: true }));
  append(decoder.decode());
}

async function withServer(port: number, prefix: string, check: (server: Server) => Promise<void>): Promise<void> {
  const scratch = await mkdtemp(join(tmpdir(), "micode-e2e-bom-"));
  const home = join(scratch, "home");
  const project = join(scratch, "project");
  try {
    await Promise.all([configure(home, port, prefix), mkdir(project)]);
    await runServer(home, project, check);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

interface Server {
  readonly project: string;
  readonly request: (path: string, payload: Record<string, unknown>) => Promise<Response>;
  readonly notices: () => string[];
}

async function runServer(home: string, project: string, check: (server: Server) => Promise<void>): Promise<void> {
  const proc = Bun.spawn(["opencode", "serve", "--port", String(PORT), "--print-logs", "--log-level", "info"], {
    cwd: project,
    env: { PATH: process.env.PATH ?? "", HOME: home, XDG_CONFIG_HOME: join(home, ".config"), [API_KEY]: "fixture" },
    stdin: "ignore",
    stderr: "pipe",
    stdout: "pipe",
  });
  let stdout = "";
  let stderr = "";
  const drained = Promise.all([
    capture(proc.stdout, (text) => {
      stdout += text;
    }),
    capture(proc.stderr, (text) => {
      stderr += text;
    }),
  ]);
  const password = () => `${stdout}\n${stderr}`.match(/server password\s+(\S+)/i)?.[1];
  try {
    await waitUntil(() => Boolean(password()), "OpenCode 2 server password");
    const headers = { Authorization: `Basic ${btoa(`opencode:${password()}`)}`, "Content-Type": "application/json" };
    await check({
      project,
      request: (path, payload) =>
        fetch(`http://127.0.0.1:${PORT}${path}?directory=${encodeURIComponent(project)}`, {
          method: "POST",
          headers,
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(10_000),
        }),
      notices: () => `${stdout}\n${stderr}`.split("\n").filter((line) => /Context Window|Auto Compacting/.test(line)),
    });
  } finally {
    proc.kill();
    await Promise.all([proc.exited, drained]);
  }
}

async function prompt(server: Server): Promise<void> {
  const session = await server.request("/api/session", {
    location: { directory: server.project },
    agent: "commander",
    model: { providerID: PROVIDER, id: MODEL },
    title: "Context window regression test",
  });
  const body = await session.text();
  if (!session.ok) throw new Error(`Session creation returned ${session.status}: ${body}`);
  const { data } = JSON.parse(body) as { data: { id: string } };
  const response = await server.request(`/api/session/${data.id}/prompt`, {
    text: "Reply to the context window regression test.",
  });
  if (!response.ok) throw new Error(`Prompt returned ${response.status}: ${await response.text()}`);
}

describe("issue #153: OpenCode 2 context limits survive a UTF-8 BOM", () => {
  let stub: ReturnType<typeof createStubProvider>;

  beforeAll(() => {
    stub = createStubProvider(SCRIPT, 0);
  });

  afterAll(() => {
    stub?.stop(true);
  });

  const cases = [
    { name: "without a BOM (control)", prefix: "" },
    { name: "with a UTF-8 BOM", prefix: "\uFEFF" },
  ];

  it.each(cases)(
    "keeps the configured 1M limit $name",
    async ({ prefix }) => {
      const port = stub.port;
      if (!port) throw new Error("Stub provider did not bind a port");
      await withServer(port, prefix, async (server) => {
        await prompt(server);
        await waitUntil(
          () => server.notices().some((line) => line.includes("Context Window:")),
          "Micode context warning",
        );
        // 800K crosses the warning threshold but not the configured 90% compaction threshold.
        const notices = server.notices().join("\n");
        expect(notices).toContain("20% remaining (800K / 1000K tokens)");
        expect(notices).not.toContain("Auto Compacting:");
      });
    },
    TEST_TIMEOUT_MS,
  );
});
