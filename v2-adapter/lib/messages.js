/**
 * Conversions between OpenCode v2 domain shapes and the v1 shapes micode's
 * hooks and tools were written against.
 *
 * v2 session messages are a flat discriminated union keyed on `type`, while v1
 * exposed `{ info, parts }` pairs with `info.role`, `info.tokens.input` and
 * `info.tokens.cache.read`.
 */

function v1Tokens(tokens) {
  return {
    input: tokens?.input ?? 0,
    output: tokens?.output ?? 0,
    reasoning: tokens?.reasoning ?? 0,
    cache: { read: tokens?.cache?.read ?? 0, write: tokens?.cache?.write ?? 0 },
  };
}

/** v2 assistant content item -> v1 message part. */
function assistantPart(part) {
  if (!part || typeof part !== "object") return undefined;
  switch (part.type) {
    case "text":
      return { type: "text", text: part.text ?? "" };
    case "reasoning":
      return { type: "reasoning", text: part.text ?? "" };
    case "tool":
      return {
        type: "tool",
        tool: part.name,
        callID: part.id,
        state: part.state ?? {},
      };
    default:
      return undefined;
  }
}

/**
 * v2 `ctx.session.context()` output -> v1 `[{ info, parts }]` message list.
 * Only user, assistant and completed-compaction messages carry information
 * micode's hooks read; everything else is dropped.
 */
export function toV1Messages(messages, sessionID) {
  const out = [];
  for (const message of messages ?? []) {
    if (!message || typeof message !== "object") continue;

    if (message.type === "user") {
      out.push({
        info: { id: message.id, sessionID, role: "user" },
        parts: [{ type: "text", text: message.text ?? "" }],
      });
      continue;
    }

    if (message.type === "assistant") {
      out.push({
        info: {
          id: message.id,
          sessionID,
          role: "assistant",
          agent: message.agent,
          modelID: message.model?.id ?? "",
          providerID: message.model?.providerID ?? "",
          error: message.error ? new Error(String(message.error.message ?? message.error.name ?? "error")) : undefined,
          tokens: v1Tokens(message.tokens),
        },
        parts: (message.content ?? []).map(assistantPart).filter(Boolean),
      });
      continue;
    }

    // v1 signalled a finished compaction with an assistant message whose
    // `summary` flag was true. micode's auto-compact hook waits for that.
    if (message.type === "compaction" && message.status === "completed") {
      out.push({
        info: {
          id: message.id,
          sessionID,
          role: "assistant",
          summary: true,
          modelID: message.model?.id ?? "",
          providerID: message.model?.providerID ?? "",
          tokens: v1Tokens(message.tokens),
        },
        parts: [{ type: "text", text: message.summary ?? "" }],
      });
    }
  }
  return out;
}

/** Last assistant text of a v2 message list (used to answer `session.prompt`). */
export function lastAssistantText(messages) {
  const list = messages ?? [];
  for (let i = list.length - 1; i >= 0; i--) {
    const message = list[i];
    if (message?.type !== "assistant") continue;
    const text = (message.content ?? [])
      .filter((part) => part?.type === "text" && part.text)
      .map((part) => part.text)
      .join("\n");
    if (text) return text;
  }
  return "";
}

/** v2 system parts -> the flat string array micode's hooks expect. */
export function systemPartsToStrings(system) {
  return (system ?? [])
    .map((part) => {
      if (typeof part === "string") return part;
      if (part?.type === "text") return part.text ?? "";
      return "";
    })
    .filter((text) => text !== "");
}

/** Did a v1 system transform actually change the text? */
export function sameStrings(after, before) {
  if (!Array.isArray(after)) return false;
  if (after.length !== before.length) return false;
  return after.every((text, index) => text === before[index]);
}

/**
 * Apply edited text back onto the original system parts.
 *
 * Rebuilding from the string array alone would drop every non-text part and any
 * per-part metadata (cache hints and the like), even when the transform changed
 * nothing. Text parts are matched positionally so each keeps its original
 * object; non-text parts are carried over untouched. Text the edit added beyond
 * the original count becomes a new part, and text it removed is dropped.
 */
export function applyStringEdits(parts, edited) {
  const texts = (edited ?? []).filter((text) => typeof text === "string");
  const out = [];
  let cursor = 0;

  for (const part of parts ?? []) {
    if (part?.type !== "text") {
      out.push(part);
      continue;
    }
    const text = texts[cursor];
    if (text === undefined) continue;
    cursor++;
    if (text === "") continue;
    out.push({ ...part, text });
  }

  for (; cursor < texts.length; cursor++) {
    if (texts[cursor] === "") continue;
    out.push({ type: "text", text: texts[cursor] });
  }
  return out;
}

/** Read a text-ish tool result the way v1 exposed it as `output.output`. */
export function resultToString(result) {
  if (!result) return "";
  if (typeof result.output === "string") return result.output;
  if (typeof result.content === "string") return result.content;
  if (Array.isArray(result.content)) {
    return result.content
      .map((part) => (part?.type === "text" ? part.text : part?.type === "file" ? `[file ${part.uri}]` : ""))
      .join("\n");
  }
  return "";
}

/**
 * Write a (possibly rewritten) string back onto a v2 tool result.
 *
 * A result can carry several text parts (plus non-text ones such as files), so
 * the rewrite has to cover all of them: updating only the first would leave the
 * old text visible in the part the agent also sees. The rewritten string goes
 * into the first text part, the rest are emptied, and non-text parts are left
 * exactly as they were.
 */
export function stringToResult(result, text) {
  if (!result || typeof result !== "object") return;
  if (typeof result.content === "string") {
    result.content = text;
    return;
  }
  if (!Array.isArray(result.content)) {
    result.output = text;
    return;
  }

  const textParts = result.content.filter((part) => part?.type === "text");
  if (textParts.length === 0) {
    result.content = [{ type: "text", text }, ...result.content];
    return;
  }
  for (const [index, part] of textParts.entries()) part.text = index === 0 ? text : "";
}
