import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Plugin } from "@opencode/plugin";
import { parse as parseJsonc } from "jsonc-parser";
import { registerAgents } from "./lib/agents.js";
import { createV1Client } from "./lib/client.js";
import { registerCommands } from "./lib/commands.js";
import { bridgeEvents } from "./lib/events.js";
import { bridgeHooks } from "./lib/hooks.js";
import { log } from "./lib/log.js";
import { loadMicode } from "./lib/micode.js";
import { registerMcp } from "./lib/mcp.js";
import { registerPermissions } from "./lib/permissions.js";
import { registerTools } from "./lib/tools.js";

/**
 * micode for OpenCode v2.
 *
 * micode 0.11.0 is an OpenCode **v1** plugin: it exports a named plugin
 * function, returns a v1 hooks object, and pins `@opencode-ai/plugin@1.18.x`.
 * v2 requires a default-exported `Plugin.define({id, setup})` that registers
 * through the plugin context, and v1 implementations do not run there.
 *
 * This wrapper loads the upstream implementation unchanged and adapts it:
 *
 *   1. a v1-shaped context (including `ctx.client`) is synthesised from the v2
 *      plugin context, and the v1 plugin function is invoked with it;
 *   2. the returned v1 hooks object is registered as v2 hooks and transforms:
 *      agents, commands, tools, MCP servers and permissions through transforms,
 *      the seven hook callbacks through session/tool hooks, and `event` through
 *      the event stream.
 *
 * See README.md for the mapping table and the list of behaviours v2 cannot
 * express.
 */

/**
 * Read `features.octtoTools` from micode.json without going through its schema.
 *
 * Parsed with `jsonc-parser` rather than a regex: a pattern cannot span nested
 * braces, matches the first `"features"` anywhere in the file (including inside
 * a comment), and fails silently. Each of those left `octtoTools` enabled while
 * the user had set it to `false`, defeating a documented kill-switch.
 */
function readFeatureFlags() {
  const base = join(homedir(), ".config", "opencode");
  for (const name of ["micode.jsonc", "micode.json"]) {
    const path = join(base, name);
    if (!existsSync(path)) continue;

    let parsed;
    try {
      parsed = parseJsonc(readFileSync(path, "utf-8"));
    } catch (error) {
      log(`could not read ${path}; leaving every feature at its default:`, error);
      return {};
    }

    if (parsed === undefined || parsed === null || typeof parsed !== "object") {
      log(`${path} is not a JSON object; leaving every feature at its default`);
      return {};
    }

    const features = parsed.features;
    const octtoTools = features && typeof features === "object" ? features.octtoTools : undefined;
    if (typeof octtoTools !== "boolean") return {};
    return { octtoTools };
  }
  return {};
}

export default Plugin.define({
  id: "micode",

  async setup(ctx) {
    const started = Date.now();
    log(`loading micode for OpenCode ${ctx.app?.version ?? "?"} in ${ctx.location.directory}`);

    const state = {
      models: new Map(),
      agentOptions: new Map(),
    };

    // 1. Run the upstream v1 plugin with a v1-shaped context.
    //    Resolved dynamically: a local `dist/` build wins over node_modules, so a
    //    fix in this repository's `src/` reaches the running plugin instead of
    //    being shadowed by the published bundle. See lib/micode.js.
    const OpenCodeConfigPlugin = await loadMicode();
    const client = createV1Client(ctx);
    const v1ctx = {
      directory: ctx.location.directory,
      worktree: ctx.location.directory,
      project: { id: ctx.location.project?.id ?? "", worktree: ctx.location.directory },
      serverUrl: new URL("http://127.0.0.1"),
      experimental_workspace: { register() {} },
      $: () => {
        throw new Error("micode-v2: the Bun shell helper is unavailable in v2 plugins");
      },
      client,
    };

    const hooks = await OpenCodeConfigPlugin(v1ctx);

    // 2. Apply the v1 `config` hook and register what it produced.
    const config = { agent: {}, command: {}, mcp: {}, permission: {} };
    await hooks.config?.(config);

    await registerAgents(ctx, config, state.agentOptions);
    await registerCommands(ctx, config);
    await registerMcp(ctx, config);
    const registrations = [await registerPermissions(ctx, config)];
    await registerTools(ctx, hooks.tool, readFeatureFlags());

    // 3. Register hooks and the event bridge.
    registrations.push(...(await bridgeHooks(ctx, hooks, state)));
    const stopEvents = bridgeEvents(ctx, hooks, state);

    log(`ready in ${Date.now() - started}ms`);

    return async () => {
      stopEvents();
      for (const registration of registrations) {
        if (!registration?.dispose) continue;
        try {
          await registration.dispose();
        } catch (error) {
          log("disposing a registration failed:", error);
        }
      }
      log("unloaded");
    };
  },
});
