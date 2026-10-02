import { log, warnOnce } from "./log.js";
import { lastAssistantText, toV1Messages } from "./messages.js";

/**
 * A v1-shaped `ctx.client` backed by the v2 session domain.
 *
 * micode calls `client.session.{create,prompt,messages,delete,summarize,abort}`
 * and `client.tui.showToast`.
 *
 * Two of those are gone from the v2 *plugin* API even though OpenCode itself
 * still has them: `session.compact` and `session.remove` exist on the client
 * and on `POST /api/session/{id}/compact`, but `SessionDomain` is an explicit
 * `Pick<SessionApi, …>` that omits both, and the plugin context exposes no raw
 * client. So a plugin cannot trigger compaction or delete a session; both
 * degrade to a logged no-op. `events.js` withholds the token counts that would
 * trigger a compaction nobody can request, so `summarize` is a safety net.
 *
 * The other notable difference is `session.prompt`. In v1 it was synchronous
 * and returned the assistant's reply, which micode depends on for
 * `spawn_agent` and octto's probe agents. v2 admits the prompt and returns a
 * receipt, so this shim waits for the session and reads the reply back, which
 * restores the v1 result shape.
 */
export function createV1Client(ctx) {
  const session = {
    async create({ body } = {}) {
      try {
        const info = await ctx.session.create({
          title: body?.title ?? undefined,
          agent: body?.agent ?? undefined,
          model: toV2Model(body?.model),
          parentID: body?.parentID ?? undefined,
        });
        return { data: info };
      } catch (error) {
        log("session.create failed:", error);
        return { error, data: undefined };
      }
    },

    async prompt({ path, body } = {}) {
      const sessionID = path?.id;
      if (!sessionID) return { data: undefined };
      const text = partsToText(body?.parts) ?? body?.text ?? "";
      try {
        await ctx.session.prompt({
          sessionID,
          agent: body?.agent ?? undefined,
          model: toV2Model(body?.model) ?? toV2Model(body),
          text,
          delivery: body?.delivery ?? undefined,
        });
      } catch (error) {
        log("session.prompt failed:", error);
        return { data: undefined, error };
      }
      return { data: { parts: [{ type: "text", text: await waitForAssistantReply(ctx, sessionID) }] } };
    },

    async messages({ path } = {}) {
      const sessionID = path?.id;
      if (!sessionID) return { data: [] };
      try {
        return { data: toV1Messages(await ctx.session.context({ sessionID }), sessionID) };
      } catch (error) {
        log("session.messages failed:", error);
        return { data: [] };
      }
    },

    async delete({ path } = {}) {
      if (typeof ctx.session.remove !== "function") {
        warnOnce(
          "session-remove",
          "ctx.session.remove() is unavailable in this OpenCode build; micode child sessions are not deleted",
        );
        return { data: true };
      }
      try {
        await ctx.session.remove({ sessionID: path?.id });
      } catch (error) {
        log("session.delete failed:", error);
      }
      return { data: true };
    },

    async summarize({ path } = {}) {
      if (typeof ctx.session.compact !== "function") {
        // micode arms a two-minute `waitForCompaction` *before* calling this, and only a
        // `message.updated` with `summary: true` resolves it. Returning quietly
        // blocked the hook for the full timeout, then auto-continued a session
        // that was never compacted. Throwing skips the wait.
        warnOnce(
          "session-compact",
          "ctx.session.compact() is unavailable in this OpenCode build, so a summary cannot be requested. This is expected: v2 keeps session.compact on the client API but omits it from the plugin SessionDomain. OpenCode compacts on its own. If this keeps firing, the token counts that trigger it are not being withheld.",
        );
        throw new Error(
          "compaction is not requestable from a v2 plugin (SessionDomain omits `compact`); OpenCode's own compaction.auto handles this session",
        );
      }
      try {
        await ctx.session.compact({ sessionID: path?.id });
      } catch (error) {
        log("session.summarize failed:", error);
        throw error;
      }
      return { data: true };
    },

    async abort({ path } = {}) {
      try {
        await ctx.session.interrupt({ sessionID: path?.id, resume: false });
      } catch (error) {
        log("session.abort failed:", error);
      }
      return { data: true };
    },

    async update() {
      return { data: {} };
    },
  };

  return {
    session,
    app: { get: async () => ({ data: { version: ctx.app?.version ?? "unknown" } }) },
    tui: {
      async showToast({ body } = {}) {
        // v2 server plugins have no toast API; keep the information in the log.
        log(`toast[${body?.variant ?? "info"}] ${body?.title ?? ""}: ${body?.message ?? ""}`);
        return { data: true };
      },
    },
  };
}

/**
 * v1's synchronous `session.prompt` was bounded by the SDK client's own
 * timeout. This shim waits on `ctx.session.wait`, which has none: a stalled
 * generation or a session that stays busy would hang `session.prompt`
 * forever, and with it the calling tool (`spawn_agent`, octto's probes). The
 * wait is capped so a stuck child returns empty instead of wedging the parent.
 */
async function waitForAssistantReply(ctx, sessionID, timeoutMs = REPLY_TIMEOUT_MS) {
  let timer;
  try {
    await Promise.race([
      ctx.session.wait({ sessionID }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`session.wait timed out after ${timeoutMs}ms`)), timeoutMs);
        timer.unref?.();
      }),
    ]);
  } catch (error) {
    log("session.wait failed:", error);
    return "";
  } finally {
    if (timer) clearTimeout(timer);
  }
  try {
    return lastAssistantText(await ctx.session.context({ sessionID }));
  } catch (error) {
    log("reading the reply failed:", error);
    return "";
  }
}

const REPLY_TIMEOUT_MS = 5 * 60 * 1000;

function partsToText(parts) {
  if (!Array.isArray(parts)) return undefined;
  return parts
    .filter((part) => part?.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");
}

/** Accept both the nested `{model:{providerID,modelID}}` and flat v1 spellings. */
function toV2Model(model) {
  if (!model || typeof model !== "object") return undefined;
  const providerID = model.providerID;
  const id = model.id ?? model.modelID;
  if (!providerID || !id) return undefined;
  return model.variant ? { providerID, id, variant: model.variant } : { providerID, id };
}
