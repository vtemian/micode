import { log } from "./log.js";

/**
 * Register micode's commands as v2 commands.
 *
 * v1 commands are `{description, agent, template}` where `template` carries
 * `$ARGUMENTS`. v2 commands only expose `{name, description, execute}`, and
 * the executor receives the arguments as `prompt.text`, so the template is
 * expanded here and submitted through the session domain.
 */
export async function registerCommands(ctx, config) {
  const commands = Object.entries(config.command ?? {});
  if (commands.length === 0) return;

  await ctx.command.transform((editor) => {
    for (const [name, definition] of commands) {
      const command = typeof definition === "string" ? { template: definition } : (definition ?? {});
      editor.add({
        name,
        description: command.description,
        execute: async ({ sessionID, prompt, delivery }) => {
          const arguments_ = prompt?.text ?? "";
          await ctx.session.prompt({
            sessionID,
            agent: command.agent,
            text: expandTemplate(command.template, arguments_),
            delivery,
          });
        },
      });
    }
  });

  log(`registered ${commands.length} command(s)`);
  await verifyCommands(
    ctx,
    commands.map(([name]) => name),
  );
}

/** Transforms are applied when the registry is read; confirm the commands landed. */
async function verifyCommands(ctx, names) {
  try {
    const listed = await ctx.command.list();
    const ids = new Set((Array.isArray(listed) ? listed : (listed?.data ?? [])).map((command) => command.name));
    const missing = names.filter((name) => !ids.has(name));
    if (missing.length > 0) log(`WARNING commands missing from the registry: ${missing.join(", ")}`);
  } catch (error) {
    log("could not verify the registered commands:", error);
  }
}

/**
 * Substitute `$ARGUMENTS` (v1) with the arguments typed after the command.
 *
 * The replacement is passed as a callback rather than a string: in a string
 * replacement `$&`, `$\`` and `$'` are substitution patterns, so an argument
 * containing any of them would be rewritten instead of inserted literally.
 */
function expandTemplate(template, arguments_) {
  if (typeof template !== "string" || template === "") return arguments_;
  return template.replaceAll("$ARGUMENTS", () => arguments_).replaceAll("${ARGUMENTS}", () => arguments_);
}
