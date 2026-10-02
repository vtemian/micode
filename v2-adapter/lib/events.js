import { log, warnOnce } from "./log.js";

const RESUBSCRIBE_BACKOFF_MS = 250;
const RESUBSCRIBE_MAX_BACKOFF_MS = 10_000;

/**
 * Feed micode's v1 `event` hook from the v2 event stream.
 *
 * v2 replaced `message.updated` with fine-grained lifecycle events, so the v1
 * events micode's hooks expect are reconstructed here:
 *
 *   v2 event                    v1 event micode receives
 *   --------------------------  ------------------------------------------------
 *   session.deleted             session.deleted  (info.id)
 *   session.usage.updated        message.updated  (assistant token usage)
 *   session.compaction.ended     message.updated  (summary: true)
 *   session.execution.failed     session.error    (sessionID, error)
 *
 * `session.usage.updated` is the closest match to v1's per-assistant-message
 * usage: it carries the session's cumulative context tokens, which is what
 * micode's auto-compact and context-window hooks compare against thresholds.
 *
 * Those token counts are withheld when a plugin cannot ask for a compaction
 * (see below), because auto-compact would otherwise decide to fire on a
 * threshold it could never act on.
 */
export function bridgeEvents(ctx, hooks, state) {
  const hook = hooks.event;
  if (typeof hook !== "function") return () => {};

  if (typeof ctx.event?.subscribe !== "function") {
    warnOnce(
      "event-stream",
      "ctx.event.subscribe() is unavailable; micode's compaction, recovery and context-window hooks are inactive",
    );
    return () => {};
  }

  // Withholding is the only honest option, and it is also what disarms the
  // trigger. `session.usage.updated` carries *cumulative* session usage (it
  // ships `cost` beside `tokens`, so both accrue for the life of the session),
  // but micode divides them by a per-request context window: `computeUsageRatio`
  // is `(input + cache.read) / contextLimit`. That ratio is unbounded and passes
  // 1 within a few turns, so no `compactionThreshold` can hold it down; passing
  // the totals through would be a cumulative number wearing a per-request
  // formula. Dropping the counts instead leaves `computeUsageRatio` null, which
  // stands the hook down. Firing would not help anyway, because a v2 plugin
  // cannot request a compaction: `SessionDomain` omits `compact`,
  // `session.command("compact")` 404s, `synthetic` makes messages rather than
  // compactions, and `ctx.rpc` only reaches plugin-registered namespaces. micode's
  // context-window toast reads the same withheld field, so it goes quiet too.
  const canCompact = typeof ctx.session?.compact === "function";
  if (!canCompact) {
    warnOnce(
      "auto-compact-withheld",
      "Withholding token counts from message.updated: session.usage.updated is cumulative session usage rather than per-request context size, so micode's usage ratio exceeds any threshold; and a v2 plugin cannot request a compaction even when it does fire. OpenCode's own compaction.auto handles long sessions.",
    );
  }

  const controller = new AbortController();
  void (async () => {
    // The stream can end for reasons that have nothing to do with teardown: a
    // stream reset, a transient connection error, a server restart. Exiting on
    // the first one left all six bridged event hooks (auto-compact, session
    // recovery, context-window monitor, truncation, file ops tracker, fetch
    // tracker) dead for the rest of the plugin's life with only a log line to
    // show for it. Resubscribe instead, backing off while not aborted.
    let backoffMs = RESUBSCRIBE_BACKOFF_MS;
    while (!controller.signal.aborted) {
      try {
        for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
          backoffMs = RESUBSCRIBE_BACKOFF_MS;
          const v1 = toV1Event(event, state, canCompact);
          if (!v1) continue;
          try {
            await hook({ event: v1 });
          } catch (error) {
            log(`event hook failed for ${event?.type}:`, error);
          }
        }
        if (controller.signal.aborted) return;
        log("event stream closed; resubscribing");
      } catch (error) {
        if (controller.signal.aborted) return;
        log(`event stream ended (${error?.message ?? error}); resubscribing in ${backoffMs}ms`);
      }
      await sleep(backoffMs, controller.signal);
      backoffMs = Math.min(backoffMs * 2, RESUBSCRIBE_MAX_BACKOFF_MS);
    }
  })();

  log("subscribed to the session event stream");
  return () => controller.abort();
}

/** Abort-aware delay, so teardown is not held up by a pending backoff. */
function sleep(ms, signal) {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();

    // The listener has to go once the wait is done, or every retry that ends
    // normally leaves a closure on the controller for the plugin's lifetime.
    let timer
    const onAbort = () => {
      clearTimeout(timer);
      finish();
    };
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      resolve();
    };

    timer = setTimeout(finish, ms);
    timer.unref?.();
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function toV1Event(event, state, canCompact) {
  const data = event?.data ?? {};
  switch (event?.type) {
    case "session.deleted": {
      // 2.0.21 sends `{ sessionID }`, but read the record shape too so a build
      // that wraps the session record in `info` still clears per-session state.
      const id = data.info?.id ?? data.sessionID;
      return { type: "session.deleted", properties: { info: { id } } };
    }

    case "session.usage.updated": {
      const model = state.models.get(data.sessionID);
      return {
        type: "message.updated",
        properties: {
          info: {
            sessionID: data.sessionID,
            role: "assistant",
            modelID: model?.id ?? "",
            providerID: model?.providerID ?? "",
            ...(canCompact
              ? { tokens: { input: data.tokens?.input ?? 0, cache: { read: data.tokens?.cache?.read ?? 0 } } }
              : {}),
          },
        },
      };
    }

    case "session.compaction.ended":
      return {
        type: "message.updated",
        properties: {
          info: {
            sessionID: data.sessionID,
            role: "assistant",
            summary: true,
            modelID: data.model?.id ?? state.models.get(data.sessionID)?.id ?? "",
            providerID: data.model?.providerID ?? state.models.get(data.sessionID)?.providerID ?? "",
            tokens: { input: data.tokens?.input ?? 0, cache: { read: data.tokens?.cache?.read ?? 0 } },
          },
        },
      };

    case "session.execution.failed":
      return { type: "session.error", properties: { sessionID: data.sessionID, error: data.error } };

    default:
      return undefined;
  }
}
