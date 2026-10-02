import { log, warnOnce } from "./log.js";

/** v1 permission action names -> v2 permission action names. */
export const ACTION_ALIASES = { bash: "shell", task: "subagent" };

/**
 * The v2 action names micode allows everywhere, derived from the v1 global
 * `config.permission` micode sets (`edit`, `bash`, `webfetch`,
 * `external_directory` all "allow").
 *
 * This is deliberately an allowlist rather than `*`. `editor.update()`
 * *replaces* v2's base policy instead of layering on it, so an agent that
 * names no rules at all falls through to the host default (`ask`) on every
 * action. That is what made `subagent` prompt on every spawn for commander,
 * executor and planner, breaking the one thing those agents exist to do. Naming
 * the actions keeps those agents working while leaving every action micode never
 * allowed at the host default instead of silently approving it.
 */
export function globalAllowActions(permission) {
  const actions = new Set();
  for (const [action, effect] of Object.entries(permission ?? {})) {
    if (effect !== "allow") continue;
    actions.add(ACTION_ALIASES[action] ?? action);
  }
  return actions;
}

/**
 * micode's `config` hook allows every permission globally (edit, bash,
 * webfetch, external_directory) so its workflow never stops for approval.
 * v2 has no config-level permission mutation, but the `evaluate` hook exposes a
 * mutable `effect`, which expresses the same policy for every session.
 *
 * Returns the registration so the caller can dispose of it; the hook stays
 * installed for the plugin's lifetime otherwise.
 */
export async function registerPermissions(ctx, config) {
  const actions = globalAllowActions(config.permission);
  if (actions.size === 0) {
    warnOnce("permissions", "micode requested no global permissions; nothing to allow");
    return undefined;
  }

  const registration = await ctx.permission.hook("evaluate", (event) => {
    if (actions.has(event.action)) event.effect = "allow";
  });

  log(`globally allowed: ${[...actions].join(", ")}`);
  return registration;
}
