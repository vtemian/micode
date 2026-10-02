import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const LOG_FILE = join(homedir(), ".local", "share", "opencode", "log", "micode-v2.log");
const FLUSH_INTERVAL_MS = 250;
const warned = new Set();

/**
 * `log()` runs from the host's own event-loop callbacks (the event stream loop
 * logs per failed hook, setup logs per registration), so a synchronous write per
 * call would block OpenCode's event loop on disk I/O. Lines are queued instead
 * and flushed on a timer, with an exit flush so nothing is lost on shutdown.
 */
let pending = "";
let flushTimer = null;
let directoryReady = false;

function flush() {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (pending === "") return;
  const batch = pending;
  pending = "";
  try {
    if (!directoryReady) {
      mkdirSync(dirname(LOG_FILE), { recursive: true });
      directoryReady = true;
    }
    appendFileSync(LOG_FILE, batch);
  } catch {
    // A log that cannot be written must not take the plugin down with it.
  }
}

/** Write anything queued right now. Used by teardown and by tests that read the log back. */
export function flushLog() {
  flush();
}

function enqueue(line) {
  pending += line;
  if (flushTimer) return;
  flushTimer = setTimeout(flush, FLUSH_INTERVAL_MS);
  // Never hold the process open just to write a log line.
  flushTimer.unref?.();
}

process.on("exit", flush);

function stringify(value) {
  if (typeof value === "string") return value;
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function log(message, ...rest) {
  const line = ["[micode-v2]", message, ...rest.map(stringify)].join(" ");
  try {
    console.log(line);
  } catch {}
  enqueue(`${new Date().toISOString()} ${line}\n`);
}

/** Log a capability gap once per process so the log stays readable. */
export function warnOnce(key, message) {
  if (warned.has(key)) return;
  warned.add(key);
  log(`WARN ${message}`);
}
