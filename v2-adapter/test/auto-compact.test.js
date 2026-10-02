/**
 * Auto-Compact regression test.
 *
 * micode's auto-compact hook fires on the token counts carried by
 * `message.updated`, then calls `client.session.summarize()` and holds the
 * session for two minutes waiting for a summary that a v2 plugin can never
 * request. Before this was fixed, `micode-v2.log` recorded
 * `Compaction timed out` roughly every two minutes.
 *
 * The real upstream hook runs against the real adapter bridge here, on usage
 * far past any threshold, and must not ask for a summary. The second half runs
 * the same scenario against a host that *does* expose `session.compact`, to
 * confirm the withholding is conditional rather than permanent.
 *
 * Run: node test/auto-compact.test.js
 */
import { readFileSync } from "node:fs";
import { check, report } from "./assert.js";
import { opencode, plugin } from "./harness.js";

const LOG = `${process.env.HOME}/.local/share/opencode/log/micode-v2.log`;
const SESSION = "ses_test";

/** 103x a 200k context limit: the ratio that made `compactionThreshold: 1` fire. */
const OVER_BUDGET = { input: 20_000, cache: { read: 20_400_000 } };

const usageEvent = { type: "session.usage.updated", data: { sessionID: SESSION, tokens: OVER_BUDGET } };

/**
 * The log does not exist until the adapter has written to it, so a read on a
 * clean HOME would throw before the harness gets a chance to create it. A
 * missing log is an empty log; any other read failure is real and rethrown.
 */
function readLog() {
  try {
    return readFileSync(LOG, "utf-8");
  } catch (error) {
    if (error?.code === "ENOENT") return "";
    throw error;
  }
}

const logSince = (line) => readLog().split("\n").slice(line).join("\n");

// --- A host that cannot request a compaction, as 2.0.21 does -----------------

let mark = readLog().split("\n").length;
const host = await opencode();
const stop = await plugin(host);
await host.emit(usageEvent);

const log = logSince(mark);
check("auto-compact stands down", !log.includes("Auto Compacting"), "it decided the session was over budget");
check("no summary is requested", !log.includes("session.compact() is unavailable"));
check("nothing times out", !log.includes("Compaction timed out"));
check(
  "the withholding is logged, so the silence is explainable",
  log.includes("Withholding token counts"),
  "expected the adapter to say why it dropped the token counts",
);

// --- The same host, but with `session.compact` present ------------------------

mark = readLog().split("\n").length;
let compacted = 0;
const capable = await opencode({
  session: {
    compact: async () => {
      compacted++;
      return { summary: "stub" };
    },
  },
});
const stopCapable = await plugin(capable);
await capable.emit(usageEvent);

const capableLog = logSince(mark);
check(
  "the withholding does not apply when compaction is available",
  !capableLog.includes("Withholding token counts"),
  "the token counts should be passed through to a host that can use them",
);
check(
  "auto-compact fires again",
  capableLog.includes("Auto Compacting"),
  "expected the hook to act on the token counts",
);
check("and it reaches session.compact", compacted > 0, `session.compact was called ${compacted} time(s)`);

await stop();
await stopCapable();
report();
process.exit(process.exitCode ?? 0);
