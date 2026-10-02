import { z } from "zod";
import { log } from "./log.js";

/**
 * Register micode's v1 tool map as v2 tools.
 *
 * v1 tools are built with `tool({ description, args, execute })`, where `args`
 * is a *zod raw shape* and `execute` returns a string or
 * `{title, output, metadata}`. v2 wants a JSON Schema for `input` and a result
 * of `{content}`. Each tool therefore gets:
 *
 *   - `input`: `z.toJSONSchema(z.object(shape), {io:"input"})`
 *   - `execute`: re-parses the input with the same zod object, so defaults,
 *                  coercion and validation behave exactly as they did in v1
 */
export async function registerTools(ctx, tools, options = {}) {
  const directory = ctx.location.directory;
  const skipped = [];
  let registered = 0;

  await ctx.tool.transform((editor) => {
    for (const [name, tool] of Object.entries(tools ?? {})) {
      if (!tool || typeof tool.execute !== "function") continue;
      if (!shouldRegister(name, options)) {
        skipped.push(name);
        continue;
      }

      let schema;
      let input;
      try {
        schema = z.object(tool.args ?? {});
        input = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" });
      } catch (error) {
        log(`tool ${name}: cannot convert its argument schema, skipping.`, error);
        skipped.push(name);
        continue;
      }

      try {
        editor.add({
          name,
          description: tool.description ?? name,
          input,
          execute: async (raw, context) => {
            const args = parseArgs(schema, raw, name);
            const result = await tool.execute(args, toolContext(context, directory));
            return toToolResult(result);
          },
        });
        registered++;
      } catch (error) {
        log(`tool ${name}: registration failed, skipping.`, error);
        skipped.push(name);
      }
    }
  });

  const total = Object.keys(tools ?? {}).length;
  const suffix = skipped.length > 0 ? `, skipped ${skipped.length}: ${skipped.join(", ")}` : "";
  log(`registered ${registered} of ${total} tool(s)${suffix}`);
  await verifyTools(ctx, tools, skipped);
}

/** Transforms are applied when the registry is read; confirm the tools landed. */
async function verifyTools(ctx, tools, skipped) {
  try {
    const listed = await ctx.tool.list();
    const ids = new Set((Array.isArray(listed) ? listed : (listed?.data ?? [])).map((tool) => tool.id));
    const expected = Object.keys(tools ?? {}).filter((name) => !skipped.includes(name));
    const missing = expected.filter((name) => !ids.has(name));
    if (missing.length > 0) log(`WARNING tools missing from the registry: ${missing.join(", ")}`);
  } catch (error) {
    log("could not verify the registered tools:", error);
  }
}

/**
 * Octto's browser-question tools are ~20 extra tools that are only useful to
 * the `octto` agent. v2 has no per-agent tool filter, so they would be offered
 * to every request. They stay enabled to match v1 behaviour and can be turned
 * off with `features.octtoTools: false` in micode.json.
 */
function shouldRegister(name, options) {
  if (!OCTTO_TOOLS.has(name)) return true;
  return options.octtoTools !== false;
}

const OCTTO_TOOLS = new Set([
  "start_session",
  "end_session",
  "get_answer",
  "get_next_answer",
  "list_questions",
  "cancel_question",
  "push_question",
  "pick_one",
  "pick_many",
  "confirm",
  "rank",
  "rate",
  "ask_text",
  "ask_image",
  "ask_file",
  "ask_code",
  "show_diff",
  "show_plan",
  "show_options",
  "review_section",
  "thumbs",
  "emoji_react",
  "slider",
  "create_brainstorm",
  "get_session_summary",
  "end_brainstorm",
  "await_brainstorm_complete",
]);

function parseArgs(schema, raw, name) {
  try {
    return schema.parse(raw ?? {});
  } catch (error) {
    // Surface the failure the way a v1 tool call would: rejected input.
    throw new Error(`Invalid arguments for ${name}: ${error.message}`);
  }
}

/** v1 `ToolContext` for a v2 tool execution. */
function toolContext(context, directory) {
  return {
    sessionID: context.sessionID,
    messageID: context.messageID,
    agent: context.agent,
    directory,
    worktree: directory,
    abort: context.signal,
    metadata(input) {
      // v1 `metadata({title, metadata})` vs v2 `progress(flat record)`.
      void context.progress({ title: input?.title, ...(input?.metadata ?? {}) });
    },
    async ask() {},
  };
}

/** v1 `ToolResult` (string | `{title, output, metadata}`) -> v2 `Tool.Result`. */
function toToolResult(result) {
  if (typeof result === "string") return { content: result };
  if (!result || typeof result !== "object") return { content: String(result ?? "") };
  const content = typeof result.output === "string" ? result.output : "";
  const metadata = { ...(result.metadata ?? {}) };
  if (result.title) metadata.title = result.title;
  return { content, ...(Object.keys(metadata).length > 0 ? { metadata } : {}) };
}
