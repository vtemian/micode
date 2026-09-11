/**
 * OpenAI-compatible chat-completions server that replays a fixed script.
 *
 * opencode drives real agents through this, so the plugin, the tool calls and
 * the file writes stay genuine while the model's output becomes deterministic.
 * Turn N of a conversation's script answers the request carrying N prior
 * assistant messages, which keeps the server stateless across retries.
 *
 * micode's flows fan out into parallel subagent sessions (spawn_agent), each
 * an independent conversation, so unlike a single-script stub the script picks
 * a conversation per request by matching a marker substring against the
 * request's messages: each agent's system prompt carries a unique role line.
 */

const DEFAULT_PORT = 8787;
const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
} as const;

export interface ToolTurn {
  readonly tool: string;
  readonly args: Record<string, unknown>;
  /** Optional content alongside the tool call, like a real assistant message. */
  readonly text?: string;
}

export interface TextTurn {
  readonly text: string;
}

export type ScriptTurn = ToolTurn | TextTurn;

/**
 * One scripted conversation. `match` is a substring unique to that agent's
 * system prompt; the conversation without a match is the default for requests
 * that match nothing (title generation, probes). At most one default.
 */
export interface ConversationScript {
  readonly match?: string;
  readonly turns: readonly ScriptTurn[];
}

interface ChatMessage {
  readonly role: string;
  readonly content?: unknown;
}

/**
 * Scripts cannot hardcode ids the tools mint at runtime, so an argument of the
 * form {"$extract": "<regex>"} is replaced by the last match seen anywhere in
 * the conversation so far.
 */
interface ExtractRef {
  readonly $extract: string;
}

function isExtractRef(value: unknown): value is ExtractRef {
  return typeof value === "object" && value !== null && "$extract" in value;
}

function lastMatch(messages: readonly ChatMessage[], pattern: string): string {
  const regex = new RegExp(pattern, "g");
  const matches = messages.flatMap((m) => JSON.stringify(m.content ?? "").match(regex) ?? []);
  const found = matches.at(-1);
  if (!found) throw new Error(`No match for /${pattern}/ in conversation so far`);
  return found;
}

function resolveArgs(args: Record<string, unknown>, messages: readonly ChatMessage[]): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(args).map(([key, value]) => [
      key,
      isExtractRef(value) ? lastMatch(messages, value.$extract) : value,
    ]),
  );
}

interface ChatRequest {
  readonly model?: string;
  readonly messages?: readonly ChatMessage[];
  readonly stream?: boolean;
}

function isToolTurn(turn: ScriptTurn): turn is ToolTurn {
  return "tool" in turn;
}

function isChatRequest(body: unknown): body is ChatRequest {
  return typeof body === "object" && body !== null;
}

function isScriptTurn(value: unknown): value is ScriptTurn {
  return typeof value === "object" && value !== null && ("tool" in value || "text" in value);
}

function isConversation(value: unknown): value is ConversationScript {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as ConversationScript;
  return (
    (candidate.match === undefined || typeof candidate.match === "string") &&
    Array.isArray(candidate.turns) &&
    candidate.turns.every(isScriptTurn)
  );
}

async function loadScript(path: string): Promise<readonly ConversationScript[]> {
  const parsed: unknown = await Bun.file(path).json();

  // A bare array of turns is shorthand for one default conversation.
  if (Array.isArray(parsed)) {
    if (!parsed.every(isScriptTurn)) throw new Error(`Script ${path} turns must be {tool,args} or {text}`);
    return [{ turns: parsed }];
  }

  const conversations = (parsed as { conversations?: unknown }).conversations;
  if (!Array.isArray(conversations) || !conversations.every(isConversation)) {
    throw new Error(`Script ${path} must be an array of turns or { conversations: [{ match?, turns }] }`);
  }

  const defaults = conversations.filter((c) => c.match === undefined);
  if (defaults.length > 1) throw new Error(`Script ${path} has ${defaults.length} default conversations; at most one`);
  return conversations;
}

function assistantTurnsSoFar(request: ChatRequest): number {
  return (request.messages ?? []).filter((m) => m.role === "assistant").length;
}

/**
 * The conversation a request belongs to: the first whose marker appears
 * anywhere in the request's messages. Specific markers must win over the
 * default, so the default (no match) is only a fallback.
 */
function pickConversation(script: readonly ConversationScript[], request: ChatRequest): ConversationScript | undefined {
  const serialized = JSON.stringify(request.messages ?? []);
  return (
    script.find((c) => c.match !== undefined && serialized.includes(c.match)) ??
    script.find((c) => c.match === undefined)
  );
}

function chunk(model: string, delta: Record<string, unknown>, finish: string | null): string {
  const payload = {
    id: "chatcmpl-stub",
    object: "chat.completion.chunk",
    created: 0,
    model,
    choices: [{ index: 0, delta, finish_reason: finish }],
  };
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function streamTurn(model: string, turn: ScriptTurn, args: Record<string, unknown>): string {
  const head = chunk(model, { role: "assistant" }, null);

  if (!isToolTurn(turn)) {
    return `${head + chunk(model, { content: turn.text }, null) + chunk(model, {}, "stop")}data: [DONE]\n\n`;
  }

  const text = turn.text ? chunk(model, { content: turn.text }, null) : "";
  const call = chunk(
    model,
    {
      tool_calls: [
        {
          index: 0,
          id: `call_${turn.tool}`,
          type: "function",
          function: { name: turn.tool, arguments: JSON.stringify(args) },
        },
      ],
    },
    null,
  );
  return `${head + text + call + chunk(model, {}, "tool_calls")}data: [DONE]\n\n`;
}

function completionBody(model: string, turn: ScriptTurn, args: Record<string, unknown>): Record<string, unknown> {
  const message = isToolTurn(turn)
    ? {
        role: "assistant",
        content: turn.text ?? null,
        tool_calls: [
          {
            id: `call_${turn.tool}`,
            type: "function",
            function: { name: turn.tool, arguments: JSON.stringify(args) },
          },
        ],
      }
    : { role: "assistant", content: turn.text };

  return {
    id: "chatcmpl-stub",
    object: "chat.completion",
    created: 0,
    model,
    choices: [{ index: 0, message, finish_reason: isToolTurn(turn) ? "tool_calls" : "stop" }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}

// Past the end of a conversation's turns the model must stop, or opencode would loop forever.
const EXHAUSTED: TextTurn = { text: "Script exhausted." };

export function createStubProvider(scriptPath: string, port: number): ReturnType<typeof Bun.serve> {
  return Bun.serve({
    port,
    idleTimeout: 0,
    async fetch(request) {
      const url = new URL(request.url);

      if (url.pathname === "/health") return new Response("ok");

      if (url.pathname.endsWith("/models")) {
        return Response.json({ object: "list", data: [{ id: "stub-model", object: "model" }] });
      }

      if (!url.pathname.endsWith("/chat/completions")) {
        // Routed here by a provider package the stub does not emulate (e.g.
        // the Responses API): log it or the failure is invisible in spec output.
        console.log(`[stub] unhandled ${request.method} ${url.pathname}`);
        return new Response("not found", { status: 404 });
      }

      const body: unknown = await request.json();
      if (!isChatRequest(body)) return new Response("bad request", { status: 400 });

      const script = await loadScript(scriptPath);
      const conversation = pickConversation(script, body);
      const index = assistantTurnsSoFar(body);
      const turn = conversation?.turns[index] ?? EXHAUSTED;
      const model = body.model ?? "stub-model";
      const args = isToolTurn(turn) ? resolveArgs(turn.args, body.messages ?? []) : {};

      const who = conversation?.match ?? "default";
      const what = isToolTurn(turn) ? `tool ${turn.tool} ${JSON.stringify(args)}` : "text";
      console.log(`[stub] ${who} turn ${index} (${model}): ${what}`);

      if (body.stream === false) return Response.json(completionBody(model, turn, args));

      return new Response(streamTurn(model, turn, args), { headers: SSE_HEADERS });
    },
  });
}

if (import.meta.main) {
  const scriptPath = process.env.STUB_SCRIPT;
  if (!scriptPath) throw new Error("STUB_SCRIPT must point at a script JSON file");

  const port = Number(process.env.STUB_PORT ?? DEFAULT_PORT);
  createStubProvider(scriptPath, port);
  console.log(`[stub] listening on ${port}, replaying ${scriptPath}`);
}
