/**
 * `session.summarize()` must fail fast, not hang.
 *
 * micode's `triggerCompaction` arms a two-minute `waitForCompaction` *before*
 * it calls `summarize()`, and only a `message.updated` carrying `summary: true`
 * resolves that promise. On a host without `session.compact` (the real state of
 * `SessionDomain` in 2.0.21) no such message can ever arrive, so a shim that
 * returns quietly parks the hook for the full timeout and then lets
 * `autoContinueAfterCompaction` inject a "Context was compacted, continue"
 * prompt into a session that was never compacted.
 *
 * Rejecting instead short-circuits all of that: micode catches it, logs a
 * failure, and clears its in-progress flag.
 *
 * Run: node test/summarize.test.js
 */
import { createV1Client } from "../lib/client.js";
import { check, report } from "./assert.js";

const SESSION = "ses_test";
const summarize = (ctx) => createV1Client(ctx).session.summarize({ path: { id: SESSION } });

// --- A host that cannot request a compaction, as 2.0.21 does -----------------

const incapable = await summarize({ session: {} }).then(
  () => ({ ok: false }),
  (error) => ({ ok: true, error }),
);

check(
  "summarize rejects instead of reporting success",
  incapable.ok,
  "a resolved value sends micode into its two-minute wait",
);
check(
  "the rejection names the real reason",
  /not requestable/i.test(incapable.error?.message ?? ""),
  `got: ${incapable.error?.message}`,
);

// --- The same call on a host that can compact ---------------------------------

let compacted;
const capable = await summarize({
  session: {
    compact: async (input) => {
      compacted = input;
      return { summary: "stub" };
    },
  },
}).then(
  (value) => ({ ok: true, value }),
  (error) => ({ ok: false, error }),
);

check("summarize still resolves when compaction is available", capable.ok, `threw: ${capable.error?.message}`);
check("and it forwards the session", compacted?.sessionID === SESSION, `called with ${JSON.stringify(compacted)}`);

report();
process.exit(process.exitCode ?? 0);
