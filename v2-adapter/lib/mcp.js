import { log } from "./log.js";

/**
 * Register micode's MCP servers. v1 and v2 agree on the local-server shape
 * (`{type:"local", command:[...]}`), so this is a direct copy. Servers the user
 * already configured are left untouched.
 */
export async function registerMcp(ctx, config) {
  const servers = config.mcp ?? {};
  if (Object.keys(servers).length === 0) return;

  const added = [];
  await ctx.mcp.transform((editor) => {
    for (const [name, server] of Object.entries(servers)) {
      if (!server || editor.get(name)) continue;
      const entry = { type: server.type ?? "local" };
      if (server.type === "remote") {
        if (server.url) entry.url = server.url;
        if (server.headers) entry.headers = server.headers;
      } else {
        entry.command = server.command;
        if (server.cwd) entry.cwd = server.cwd;
        if (server.environment) entry.environment = server.environment;
      }
      if (server.disabled) entry.disabled = server.disabled;
      editor.set(name, entry);
      added.push(name);
    }
  });

  const kept = Object.keys(servers).length - added.length;
  const suffix = kept > 0 ? `, left ${kept} already configured` : "";
  log(`registered ${added.length} MCP server(s): ${added.join(", ")}${suffix}`);
}
