import { log, warnOnce } from "./log.js";
import {
  applyStringEdits,
  resultToString,
  sameStrings,
  stringToResult,
  systemPartsToStrings,
  toV1Messages,
} from "./messages.js";

/**
 * micode's constraint reviewer throws this once a file has exhausted its review
 * retries. It is not exported from the published bundle, so it is identified by
 * its stable `name` rather than by identity.
 */
function isConstraintViolation(error) {
  return error instanceof Error && error.name === "ConstraintViolationError";
}

/**
 * Bridge micode's v1 hooks onto v2 registrations.
 *
 *   v1 hook                                 v2 registration
 *   --------------------------------------  ---------------------------------
 *   chat.message                            session.hook("prompt")
 *   chat.params                             session.hook("context"/"generate")
 *   experimental.chat.system.transform       session.hook("context")
 *   experimental.chat.messages.transform     session.hook("context")
 *   experimental.session.compacting          session.hook("compaction")
 *   tool.execute.after                       tool.hook("execute.after")
 *
 * `experimental.chat.messages.transform` and `experimental.chat.system.transform`
 * have no distinct v2 hook: both edits happen on the context event, so they run
 * inside the same `context`/`generate` registration.
 */
export async function bridgeHooks(ctx, hooks, state) {
  const registrations = [];
  const register = async (promise) => registrations.push(await promise);

  if (hooks["chat.message"]) {
    await register(
      ctx.session.hook("prompt", async (event) => {
        const input = { sessionID: event.sessionID, model: state.models.get(event.sessionID) };
        const output = { parts: [{ type: "text", text: event.prompt?.text ?? "" }] };
        try {
          await hooks["chat.message"](input, output);
        } catch (error) {
          log("chat.message bridge failed:", error);
        }
      }),
    );
  }

  if (
    hooks["chat.params"] ||
    hooks["experimental.chat.system.transform"] ||
    hooks["experimental.chat.messages.transform"]
  ) {
    // `context` covers the agent loop; `generate` covers transient generations.
    // `title` is deliberately skipped so session titles stay cheap, and
    // `compaction` only receives the summary template below.
    for (const kind of ["context", "generate"]) {
      await register(
        ctx.session.hook(kind, async (event) => {
          try {
            state.models.set(event.sessionID, event.model);

            applyAgentOptions(event, state.agentOptions.get(event.agent));

            if (hooks["experimental.chat.system.transform"]) {
              const original = event.system ?? [];
              const before = systemPartsToStrings(original);
              const out = { system: [...before] };
              await hooks["experimental.chat.system.transform"]({ sessionID: event.sessionID }, out);
              if (!sameStrings(out.system, before)) {
                event.system = applyStringEdits(original, out.system);
              }
            }

            if (hooks["experimental.chat.messages.transform"]) {
              // Read-only in v1 for the mindmodel injector, which matches
              // patterns and prepares an injection; nothing to write back.
              // `event.messages` is the v2 flat union (`type`/`text`/`content`),
              // the same shape `session.context()` returns, so it needs the
              // v1 `{info, parts}` conversion the hook expects. Converting it
              // as if it were already v1 produced `{role:"user", content:[]}`
              // for every message and the injector could never match a task.
              const out = { messages: toV1Messages(event.messages, event.sessionID) };
              await hooks["experimental.chat.messages.transform"]({ sessionID: event.sessionID }, out);
            }

            if (hooks["chat.params"]) {
              // v1 gave `chat.params` a *string* `output.system` (its hooks
              // concatenate onto it), unlike the system transform above which
              // got a string[]. The text is collapsed into one part and only
              // replaced when micode actually changed it, so other part types
              // and their cache hints survive.
              const parts = event.system ?? [];
              const text = systemPartsToStrings(parts).join("\n\n");
              // fragment-injector reads the agent name from `options.agent`, so
              // it is provided and stripped again before the request is sent.
              const options = { ...event.options, agent: event.agent };
              const out = { system: text, options };
              await hooks["chat.params"]({ sessionID: event.sessionID }, out);
              delete out.options.agent;
              event.options = out.options;
              if (typeof out.system === "string" && out.system !== text) {
                const others = parts.filter((part) => part?.type !== "text");
                event.system = out.system ? [{ type: "text", text: out.system }, ...others] : others;
              }
            }
          } catch (error) {
            log(`chat context bridge failed (${kind}):`, error);
          }
        }),
      );
    }
  }

  if (hooks["experimental.session.compacting"]) {
    await register(
      ctx.session.hook("compaction", async (event) => {
        try {
          const out = { context: systemPartsToStrings(event.system), prompt: undefined };
          await hooks["experimental.session.compacting"]({ sessionID: event.sessionID }, out);
          // v2 appends its own summary prompt after hooks run and offers no way
          // to replace it, so the structured-summary instructions are injected
          // as a system part instead.
          if (typeof out.prompt === "string" && out.prompt !== "") {
            event.system.push({ type: "text", text: out.prompt });
          }
        } catch (error) {
          log("compaction bridge failed:", error);
        }
      }),
    );
  }

  if (hooks["tool.execute.after"]) {
    await register(
      ctx.tool.hook("execute.after", async (event) => {
        if (event.status !== "completed") return;
        try {
          const before = resultToString(event.result);
          const output = { output: before };
          const input = {
            tool: event.tool,
            sessionID: event.sessionID,
            callID: event.id,
            args: normalizeArgs(event.input),
          };
          await hooks["tool.execute.after"](input, output);
          if (typeof output.output === "string" && output.output !== before) {
            stringToResult(event.result, output.output);
          }
        } catch (error) {
          // The constraint reviewer throws this once a file has exhausted its
          // review retries. It is an enforcement verdict, not a bridge fault:
          // swallowing it here would return the Write/Edit's original
          // successful result and the model would carry on as if it had passed.
          if (isConstraintViolation(error)) throw error;
          log(`tool.execute.after bridge failed for ${event.tool}:`, error);
        }
      }),
    );
  }

  const missing = Object.entries(hooks)
    .filter(([key, value]) => typeof value === "function" && !HANDLED.has(key))
    .map(([key]) => key);
  if (missing.length > 0) {
    warnOnce("unbridged-hooks", `no v2 equivalent, left inactive: ${missing.join(", ")}`);
  }

  log(`bridged ${BRIDGED.size} hook(s)`);
  return registrations;
}

const BRIDGED = new Set([
  "chat.message",
  "chat.params",
  "experimental.chat.system.transform",
  "experimental.chat.messages.transform",
  "experimental.session.compacting",
  "tool.execute.after",
]);

/** Hooks adapted outside this module: `config` through transforms, `event` through the stream. */
const HANDLED = new Set([...BRIDGED, "config", "event"]);

/**
 * v2 has no per-agent generation settings, so micode's agent temperature and
 * maxTokens are applied per request. Only unset options are filled in, so a
 * later hook or provider default still wins.
 */
function applyAgentOptions(event, agentOptions) {
  if (!agentOptions) return;
  const { temperature, maxTokens } = agentOptions;
  if (typeof temperature === "number" && event.options.temperature === undefined) {
    event.options.temperature = temperature;
  }
  if (typeof maxTokens === "number" && event.options.maxTokens === undefined) {
    event.options.maxTokens = maxTokens;
  }
}

/**
 * micode's tool hooks disagree on argument spelling (`filePath` in most of
 * them, `new_string` in the comment checker, `file_path` in the constraint
 * reviewer), so every common alias is added to the object they receive.
 */
function normalizeArgs(input) {
  const args = input && typeof input === "object" ? { ...input } : {};
  const filePath = args.filePath ?? args.file_path ?? args.path ?? args.notebook_path;
  if (filePath !== undefined) {
    args.filePath = filePath;
    args.file_path = filePath;
  }
  const nextString = args.newString ?? args.new_string ?? args.content ?? args.text;
  if (nextString !== undefined) {
    args.newString = nextString;
    args.new_string = nextString;
  }
  return args;
}
