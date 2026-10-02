/**
 * A stand-in for the v2 host, so the adapter can be exercised without a server.
 *
 * It implements only the surface the adapter touches, and records what the
 * adapter registered so a test can assert against it. `session.compact` is
 * deliberately absent: that is the real state of `SessionDomain` in 2.0.21, and
 * the tests depend on that.
 */
import adapter from "../index.js";
import { flushLog } from "../lib/log.js";

/** Deferred, so `subscribe` can stay open until the test closes it. */
function channel() {
  const waiting = [];
  return {
    push(event) {
      const next = waiting.shift();
      if (next) next({ value: event });
    },
    close() {
      for (const next of waiting.splice(0)) next({ done: true });
    },
    [Symbol.asyncIterator]() {
      return {
        next: () => new Promise((resolve) => waiting.push(resolve)),
        return: () => Promise.resolve({ done: true }),
      };
    },
  };
}

/** A transform's editor: drafts come from whatever is already registered. */
function agentEditor(registry) {
  return {
    get: (id) => registry.entries.get(id),
    default: (id) => {
      registry.setDefault(id);
    },
    update(id, apply) {
      const draft = registry.entries.get(id) ?? {};
      apply(draft);
      registry.entries.set(id, draft);
    },
  };
}

function namedEditor(registry, name = "entries") {
  return {
    get: (id) => registry[name].get(id),
    add: (entry) => registry[name].set(entry.name, entry),
    set: (id, entry) => registry[name].set(id, entry),
    update: (id, entry) => registry[name].set(id, { ...entry, name: id }),
    remove: (id) => registry[name].delete(id),
  };
}

export async function opencode({ location = {}, session = {}, messages = [] } = {}) {
  // `ctx.session.context()` returns the session's message list, per SessionApi.
  const sessionMessages = messages;
  const agents = { entries: new Map(), default: undefined };
  agents.setDefault = (id) => {
    agents.default = id;
  };

  const commands = { entries: new Map() };
  const tools = { entries: new Map() };
  const mcp = { entries: new Map() };
  const stream = channel();

  const hooks = { session: new Map(), tool: new Map(), permission: new Map() };
  const events = [];
  const disposals = new Map();

  const on = (registry, name, handler) => {
    if (!registry.has(name)) registry.set(name, []);
    registry.get(name).push(handler);
    return { dispose: async () => registry.get(name).splice(registry.get(name).indexOf(handler), 1) };
  };

  const ctx = {
    app: { version: "2.0.21" },
    location: { directory: process.cwd(), project: { id: "prj_test" }, ...location },
    options: {},

    session: {
      create: async (input) => ({ id: "ses_created", ...input }),
      get: async () => ({ id: "ses_test" }),
      prompt: async () => ({ info: { id: "msg_test" } }),
      wait: async () => ({}),
      context: async () => sessionMessages,
      interrupt: async () => ({}),
      switchAgent: async () => ({}),
      switchModel: async () => ({}),
      command: async () => ({}),
      hook: async (name, handler) => on(hooks.session, name, handler),
      ...session,
    },

    agent: {
      list: async () => [...agents.entries].map(([id, agent]) => ({ id, ...agent })),
      transform: async (fn) => fn(agentEditor(agents)),
    },
    command: {
      list: async () => [...commands.entries.values()],
      transform: async (fn) => fn(namedEditor(commands)),
    },
    tool: {
      list: async () => [...tools.entries.values()],
      transform: async (fn) => fn(namedEditor(tools)),
      hook: async (name, handler) => on(hooks.tool, name, handler),
    },
    mcp: { transform: async (fn) => fn(namedEditor(mcp)) },
    permission: { hook: async (name, handler) => on(hooks.permission, name, handler) },
    model: { list: async () => [] },

    event: {
      subscribe: ({ signal } = {}) => {
        signal?.addEventListener("abort", () => stream.close());
        return stream;
      },
    },

    // What the adapter registered, for assertions.
    registries: { agents, commands, tools, mcp },
    hooks,
    events,

    async emit(event) {
      events.push(event);
      stream.push(event);
      // Hooks are awaited by the bridge, but the emit call is not; give the
      // bridge a turn so a test can assert on what it did.
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setTimeout(resolve, 50));
      // Logging is buffered, so a test reading the log back needs it on disk.
      flushLog();
    },
  };

  return ctx;
}

/** Run the adapter's `setup` against a stub host and return its disposer. */
export async function plugin(ctx) {
  const stop = await adapter.setup(ctx);
  return async () => {
    await stop?.();
  };
}
