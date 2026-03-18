// src/tools/pty/manager.ts
import { extractErrorMessage } from "@/utils/errors";
import { createRingBuffer } from "./buffer";
import type { PTYSession, PTYSessionInfo, ReadResult, SearchResult, SpawnOptions } from "./types";

// bun-pty types used locally - the actual module is injected via init()
type IPty = import("bun-pty").IPty;
type Spawner = typeof import("bun-pty").spawn;

const ID_RANDOM_BYTES = 4;
const HEX_RADIX = 16;
const ID_SUFFIX_LENGTH = -4;
const PTY_UNAVAILABLE_MSG =
  "PTY unavailable: bun-pty native library could not be loaded. " +
  "Set BUN_PTY_LIB environment variable to the path of the native library " +
  "(e.g., .opencode/node_modules/bun-pty/rust-pty/target/release/librust_pty.dylib)";

export interface PTYManager {
  init(fn: Spawner): void;
  readonly available: boolean;
  spawn(opts: SpawnOptions): PTYSessionInfo;
  write(id: string, data: string): boolean;
  read(id: string, offset?: number, limit?: number): ReadResult | null;
  search(id: string, pattern: RegExp, offset?: number, limit?: number): SearchResult | null;
  list(): PTYSessionInfo[];
  get(id: string): PTYSessionInfo | null;
  kill(id: string, cleanup?: boolean): boolean;
  cleanupBySession(parentSessionId: string): void;
  cleanupAll(): void;
}

function generateId(): string {
  const hex = Array.from(crypto.getRandomValues(new Uint8Array(ID_RANDOM_BYTES)))
    .map((b) => b.toString(HEX_RADIX).padStart(2, "0"))
    .join("");
  return `pty_${hex}`;
}

function toInfo(session: PTYSession): PTYSessionInfo {
  return {
    id: session.id,
    title: session.title,
    command: session.command,
    args: session.args,
    workdir: session.workdir,
    status: session.status,
    exitCode: session.exitCode,
    pid: session.pid,
    createdAt: session.createdAt,
    lineCount: session.buffer.length,
  };
}

function spawnPtyProcess(
  spawner: Spawner,
  command: string,
  args: string[],
  workdir: string,
  env: Record<string, string>,
): IPty {
  try {
    return spawner(command, args, { name: "xterm-256color", cols: 120, rows: 40, cwd: workdir, env });
  } catch (e) {
    const errorMsg = extractErrorMessage(e);
    throw new Error(`Failed to spawn PTY for command "${command}": ${errorMsg}`, { cause: e });
  }
}

function buildTitle(opts: SpawnOptions, args: string[], id: string): string {
  return opts.title ?? (`${opts.command} ${args.join(" ")}`.trim() || `Terminal ${id.slice(ID_SUFFIX_LENGTH)}`);
}

function createSession(id: string, opts: SpawnOptions, args: string[], workdir: string, ptyProcess: IPty): PTYSession {
  const buffer = createRingBuffer();
  const session: PTYSession = {
    id,
    title: buildTitle(opts, args, id),
    command: opts.command,
    args,
    workdir,
    env: opts.env,
    status: "running",
    pid: ptyProcess.pid,
    createdAt: new Date(),
    parentSessionId: opts.parentSessionId,
    buffer,
    process: ptyProcess,
  };

  ptyProcess.onData((data: string) => buffer.append(data));
  ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
    if (session.status === "running") {
      session.status = "exited";
      session.exitCode = exitCode;
    }
  });

  return session;
}

function killSession(sessions: Map<string, PTYSession>, id: string, cleanup: boolean = false): boolean {
  const session = sessions.get(id);
  if (!session) return false;

  if (session.status === "running") {
    try {
      session.process.kill();
    } catch {
      // Process may already be dead
    }
    session.status = "killed";
  }

  if (cleanup) {
    session.buffer.clear();
    sessions.delete(id);
  }

  return true;
}

function readFromSession(session: PTYSession, offset: number, limit?: number): ReadResult {
  const lines = session.buffer.read(offset, limit);
  const totalLines = session.buffer.length;
  const hasMore = offset + lines.length < totalLines;
  return { lines, totalLines, offset, hasMore };
}

function searchInSession(session: PTYSession, pattern: RegExp, offset: number, limit?: number): SearchResult {
  const matches = session.buffer.search(pattern);
  const totalMatches = matches.length;
  const totalLines = session.buffer.length;
  const paginatedMatches = limit !== undefined ? matches.slice(offset, offset + limit) : matches.slice(offset);
  const hasMore = offset + paginatedMatches.length < totalMatches;
  return { matches: paginatedMatches, totalMatches, totalLines, offset, hasMore };
}

function spawnSession(spawner: Spawner, sessions: Map<string, PTYSession>, opts: SpawnOptions): PTYSessionInfo {
  const id = generateId();
  const args = opts.args ?? [];
  const workdir = opts.workdir ?? process.cwd();
  const env = { ...process.env, ...opts.env } as Record<string, string>;
  const ptyProcess = spawnPtyProcess(spawner, opts.command, args, workdir, env);
  const session = createSession(id, opts, args, workdir, ptyProcess);
  sessions.set(id, session);
  return toInfo(session);
}

function writeToSession(sessions: Map<string, PTYSession>, id: string, data: string): boolean {
  const session = sessions.get(id);
  if (!session || session.status !== "running") return false;
  session.process.write(data);
  return true;
}

function cleanupByParent(sessions: Map<string, PTYSession>, parentSessionId: string): void {
  for (const [id, session] of sessions) {
    if (session.parentSessionId === parentSessionId) killSession(sessions, id, true);
  }
}

function cleanupAllSessions(sessions: Map<string, PTYSession>): void {
  for (const id of sessions.keys()) killSession(sessions, id, true);
}

export function createPTYManager(): PTYManager {
  const sessions: Map<string, PTYSession> = new Map();
  let spawner: Spawner | null = null;
  let isAvailable = false;

  return {
    init(fn: Spawner): void {
      spawner = fn;
      isAvailable = true;
    },
    get available(): boolean {
      return isAvailable;
    },
    spawn(opts: SpawnOptions): PTYSessionInfo {
      if (!spawner) throw new Error(PTY_UNAVAILABLE_MSG);
      return spawnSession(spawner, sessions, opts);
    },
    write(id: string, data: string): boolean {
      return writeToSession(sessions, id, data);
    },
    read(id: string, offset = 0, limit?: number): ReadResult | null {
      return readFromManager(sessions, id, offset, limit);
    },
    search(id: string, pattern: RegExp, offset = 0, limit?: number): SearchResult | null {
      return searchFromManager(sessions, id, pattern, offset, limit);
    },
    list: (): PTYSessionInfo[] => Array.from(sessions.values()).map((s) => toInfo(s)),
    get: (id: string): PTYSessionInfo | null => {
      const s = sessions.get(id);
      return s ? toInfo(s) : null;
    },
    kill: (id: string, cleanup = false): boolean => killSession(sessions, id, cleanup),
    cleanupBySession: (parentSessionId: string): void => cleanupByParent(sessions, parentSessionId),
    cleanupAll: (): void => cleanupAllSessions(sessions),
  };
}

function readFromManager(
  sessions: Map<string, PTYSession>,
  id: string,
  offset: number,
  limit?: number,
): ReadResult | null {
  const session = sessions.get(id);
  return session ? readFromSession(session, offset, limit) : null;
}

function searchFromManager(
  sessions: Map<string, PTYSession>,
  id: string,
  pattern: RegExp,
  offset: number,
  limit?: number,
): SearchResult | null {
  const session = sessions.get(id);
  return session ? searchInSession(session, pattern, offset, limit) : null;
}
