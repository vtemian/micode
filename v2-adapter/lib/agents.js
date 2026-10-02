import { log } from "./log.js";
import { ACTION_ALIASES, globalAllowActions } from "./permissions.js";

/**
 * Register micode's agents as v2 agents.
 *
 * v2 agents are not a plugin registrable surface in the type declarations, but
 * `AgentEditor.update()` upserts: updating an unknown id creates a full agent
 * record from the defaults. That is what makes this port possible, so agents
 * are registered from the plugin instead of being written out as markdown.
 *
 * Field mapping:
 *   description -> description
 *   mode        -> mode            (`primary` | `subagent` | `all`)
 *   prompt      -> system
 *   model       -> model           (omitted when unavailable, so v2 inherits)
 *   permission  -> permissions[]   (ordered `{action, resource, effect}` rules)
 *   tools       -> permissions[]   (`false` entries become deny rules)
 *
 * `temperature` and `maxTokens` have no per-agent field in v2, so they are
 * collected here and applied per request through the context hook.
 */
export async function registerAgents(ctx, config, agentOptions) {
  const agents = Object.entries(config.agent ?? {}).filter(([, agent]) => agent);
  const available = await availableModels(ctx);
  const pinned = new Map();
  const base = baseActions(config.permission);

  await ctx.agent.transform((editor) => {
    for (const [name, agent] of agents) {
      const model = resolveModel(agent.model, available);

      editor.update(name, (draft) => {
        if (agent.description) draft.description = agent.description;
        draft.mode = agent.mode ?? "all";
        if (agent.prompt) draft.system = agent.prompt;
        if (model) {
          draft.model = model;
          pinned.set(name, `${model.providerID}/${model.id}`);
        }
        const rules = permissionRules(agent.permission, agent.tools, base);
        if (rules.length > 0) draft.permissions = rules;
      });

      agentOptions.set(name, {
        temperature: agent.temperature,
        maxTokens: agent.maxTokens,
        thinking: agent.thinking,
      });
    }

    // micode makes its primary agent the entry point unless the user chose one.
    const preferred = config.default_agent;
    if (preferred && editor.get(preferred)) editor.default(preferred);
  });

  log(`registered ${agents.length} agent(s)`);
  if (pinned.size > 0) {
    const distinct = [...new Set(pinned.values())];
    log(`agents pinned to a model: ${pinned.size} (${distinct.join(", ")})`);
  } else {
    log("agents inherit the session model (micode's configured model is unavailable)");
  }
  await verifyAgents(
    ctx,
    agents.map(([name]) => name),
  );
}

/**
 * Transforms are applied when the registry is read, so confirm the agents the
 * transform declared are actually the ones OpenCode resolves.
 */
async function verifyAgents(ctx, names) {
  try {
    const listed = await ctx.agent.list();
    const ids = new Set((Array.isArray(listed) ? listed : (listed?.data ?? [])).map((agent) => agent.id));
    const missing = names.filter((name) => !ids.has(name));
    if (missing.length > 0) log(`WARNING agents missing from the registry: ${missing.join(", ")}`);
  } catch (error) {
    log("could not verify the registered agents:", error);
  }
}

/** `provider/model[#variant]` -> v2 model reference, or undefined when unknown. */
function resolveModel(model, available) {
  if (typeof model !== "string" || !model.includes("/")) return undefined;
  const [head, ...rest] = model.split("/");
  const providerID = head;
  const id = rest.join("/");
  const [modelID, variant] = id.split("#");
  if (available.size > 0 && !available.has(`${providerID}/${modelID}`)) return undefined;
  return variant ? { providerID, id: modelID, variant } : { providerID, id: modelID };
}

async function availableModels(ctx) {
  try {
    const listed = await ctx.model.list();
    const data = Array.isArray(listed) ? listed : (listed?.data ?? []);
    const keys = new Set(data.map((model) => `${model.providerID}/${model.id}`));
    log(`model registry: ${keys.size} model(s)`);
    return keys;
  } catch (error) {
    log("could not list models, agent models are passed through unchecked:", error);
    return new Set();
  }
}

/**
 * The v2 actions every micode agent may take, derived from the same global
 * `config.permission` micode sets in v1, so agent rules and the global hook
 * cannot drift apart.
 */
function baseActions(permission) {
  const actions = globalAllowActions(permission);
  // v1's `task` is what `spawn_agent` and octto's probes call. Without it the
  // host default (`ask`) prompts on every spawn, for the agents whose whole
  // job is spawning.
  actions.add("subagent");
  return actions;
}

/**
 * v1 `{action: "allow"|"deny"|"ask"}` maps and v1 `tools: {name: false}`
 * restrictions collapse into one ordered list of v2 rules. v1 had one effect
 * per action, so no ordering conflict exists between them.
 *
 * `base` restores v1's permissive baseline, which `editor.update()` otherwise
 * replaces wholesale rather than layering on. Actions outside `base` are left
 * undeclared on purpose: they keep the host default instead of being
 * auto-approved.
 *
 * The base is only a default, so the agent's own rules are collected separately
 * and always win, including over a base allow. Seeding the base into the same
 * map with a first-write-wins guard silently dropped every per-agent deny on an
 * action that was already in the base, which handed read-only agents `edit` and
 * `shell`; v2 takes the last matching rule, so ordering is what decides it.
 * `subagent` is the exception: it is a base default that no agent declares, so
 * it lands last and stays in effect.
 */
function permissionRules(permission, tools, base) {
  const own = new Map();
  const set = (action, effect) => {
    if (!action) return;
    own.set(ACTION_ALIASES[action] ?? action, effect);
  };

  for (const [action, effect] of Object.entries(permission ?? {})) {
    if (effect === "allow" || effect === "deny" || effect === "ask") set(action, effect);
  }

  for (const [name, enabled] of Object.entries(tools ?? {})) {
    if (enabled !== false) continue;
    if (name === "spawn_agent") continue; // a micode tool, not a permission
    set(name, "deny");
  }

  const rules = new Map();
  for (const action of base) rules.set(action, "allow");
  for (const [action, effect] of own) rules.set(action, effect);
  return [...rules].map(([action, effect]) => ({ action, resource: "*", effect }));
}
