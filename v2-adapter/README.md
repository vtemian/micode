# micode-v2 — micode for OpenCode v2

An adapter that runs [micode](https://github.com/vtemian/micode) 0.11.0 on
OpenCode v2. It loads the upstream implementation unchanged and translates its
OpenCode **v1** plugin API into the v2 plugin API.

## Why this exists

micode 0.11.0 is a v1 plugin:

| | micode 0.11.0 | OpenCode v2 requires |
| --- | --- | --- |
| Entrypoint | `export { OpenCodeConfigPlugin }` (named) | `export default Plugin.define({ id, setup })` |
| Hooks | returns a v1 hooks object | registers through `ctx.session.hook`, `ctx.tool.hook`, … |
| Config | mutates the host `config` object | domain transforms (`ctx.agent.transform`, …) |
| SDK | `@opencode-ai/plugin@1.18.30` | `@opencode/plugin` |

The v2 docs are explicit that *"V1 plugin implementations do not run in V2"*,
and upstream `main` is still pinned to the v1 plugin package, so no released
micode version loads on v2. This directory is that port.

## How it works

`index.js` does two things:

1. Builds a v1-shaped plugin context from the v2 one — `ctx.client` is shimmed
   onto the v2 session domain — and calls micode's `OpenCodeConfigPlugin` with it.
2. Takes the returned v1 hooks object and registers each piece through the
   matching v2 API.

## Mapping

### From the `config` hook

| v1 | v2 |
| --- | --- |
| `config.agent[name]` | `ctx.agent.transform(editor => editor.update(name, …))` |
| `config.command[name]` | `ctx.command.transform(editor => editor.add(…))` |
| `config.mcp[name]` | `ctx.mcp.transform(editor => editor.set(name, …))` |
| `config.permission` (allow-all) | `ctx.permission.hook("evaluate", e => { e.effect = "allow" })` |
| `config.default_agent` | `editor.default(name)` |

Agent fields map as: `description` → `description`, `mode` → `mode`, `prompt` →
`system`, `model` → `model` (omitted when unavailable, see below), and both
`permission` and the `tools: {x: false}` restrictions collapse into v2's
ordered `permissions` rules (`bash` → `shell`, `task` → `subagent`).

`AgentEditor.update()` upserts, so agents are registered from the plugin — no
markdown files under `~/.config/opencode/agents/`.

### Tools

v1 tools are `tool({ description, args, execute })`, where `args` is a zod *raw
shape*. Each one becomes:

- `input` — `z.toJSONSchema(z.object(shape), { io: "input" })`
- `execute` — re-parses the input with the same zod object before calling
  micode, so defaults, coercion and validation behave exactly as in v1
- result — v1's `string` / `{title, output, metadata}` becomes `{content}`

Tool hooks disagree on argument spelling (`filePath`, `file_path`,
`new_string`, `newString`), so the `execute.after` bridge passes every common
alias in the args object it forwards.

### Hooks

| v1 hook | v2 registration |
| --- | --- |
| `chat.message` | `session.hook("prompt")` |
| `chat.params` | `session.hook("context")`, `session.hook("generate")` |
| `experimental.chat.system.transform` | folded into the same context hook |
| `experimental.chat.messages.transform` | folded into the same context hook |
| `experimental.session.compacting` | `session.hook("compaction")` |
| `tool.execute.after` | `tool.hook("execute.after")` |
| `event` | `ctx.event.subscribe()` |

Note that v1 gave `chat.params` a **string** `output.system` (its hooks
concatenate onto it) while the system transform got a **string[]**. The bridge
keeps those shapes distinct: the text is collapsed into one system part for
`chat.params` and only replaced when micode changed it.

### Events

v2 replaced `message.updated` with fine-grained events, so v1 events are
reconstructed from the closest v2 equivalent:

| v2 event | v1 event micode receives |
| --- | --- |
| `session.deleted` | `session.deleted` |
| `session.usage.updated` | `message.updated` (assistant token usage) |
| `session.compaction.ended` | `message.updated` (`summary: true`) |
| `session.execution.failed` | `session.error` |

## Compaction

Compaction exists in v2 — the docs describe it in full, `POST
/api/session/{id}/compact` accepts a request and was verified working on this
build, and the client has `session.compact` (with a `SessionInboxCompaction`
result and `session.compaction.*` events). It is not a slash command, though:
`command.list` returns only `init`, `review` and the plugin-registered ones, and
`POST /api/session/{id}/command` with `{"name":"compact"}` answers
`CommandNotFoundError: Command not found: compact` — byte-identical to a bogus
name, while `{"name":"review"}` succeeds. Any `/`-prefixed command beyond
`init`/`review` would be TUI-local, which is client state this adapter cannot
inspect.

What is missing is narrower, and it is the plugin API rather than the
platform: `SessionDomain` is an explicit

```ts
Pick<SessionApi, "create" | "get" | "switchAgent" | "switchModel" | "prompt"
  | "generate" | "command" | "synthetic" | "interrupt" | "update" | "move"
  | "wait" | "context">
```

so `compact` and `remove` are omitted, and the plugin `Context` exposes no raw
client to reach them another way. A plugin therefore cannot *request* a
compaction — only observe and shape one that OpenCode decides to run.

That matters for micode's Auto-Compact hook, which watches context usage and
then calls `client.session.summarize()` and waits two minutes for a summary
message. Left alone it fires, the request does nothing, and the wait ends in
`Compaction timed out` — which is exactly what `micode-v2.log` recorded every
couple of minutes while this was being looked at.

micode's own knob cannot fix it. `compactionThreshold` in `micode.jsonc` is
clamped to `[0, 1]` and the hook fires on `usageRatio >= threshold`, but
`computeUsageRatio` is `(input + cache.read) / contextLimit` — a per-request
formula — while the only usage v2 offers is `session.usage.updated`, whose
payload is `{ sessionID, cost, tokens }`. `cost` is money spent so far this
session, and `tokens` accrues beside it for the same life, so the event carries
*a cumulative* total. Divided by one request's context window the ratio is
unbounded: a session with a 200k limit reached 103×, which is ~20M tokens, not a
window. No threshold in `[0, 1]` can exclude that, so the hook fired on
essentially every message.

That leaves two options, and only one is honest. Passing the totals through
would report session-cumulative usage in a per-request field, producing a
context-percentage toast that is wrong by orders of magnitude. So the adapter
withholds the counts in `lib/events.js` — they are the only input auto-compact
acts on, and with no `tokens` `computeUsageRatio` returns null and the hook
stands down. This is conditional on `typeof ctx.session.compact === "function"`:
should a future OpenCode expose compaction to plugins, the withholding lifts on
its own and the full path returns. The cost is micode's cosmetic "Context: N%
remaining" toast, which reads the same withheld field and goes quiet with it —
acceptable, since its numbers were never truthful on v2 anyway.

`summarize()` itself now *rejects* rather than returning quietly
(`lib/client.js`). micode arms its two-minute `waitForCompaction` before calling
it and only a `message.updated` with `summary: true` resolves that promise, so
the old no-op return parked the hook for the full timeout and then let
`autoContinueAfterCompaction` inject a "Context was compacted, continue" prompt
into a session that was never compacted. Throwing skips the wait entirely:
micode catches it, logs a failure, and clears its in-progress flag. This is
defence in depth — the withholding means the hook should not reach it at all.

### What actually compacts

OpenCode's own automatic compaction, which is on by default:

```jsonc title="~/.config/opencode/opencode.json"
{ "compaction": { "auto": true, "keep": { "tokens": 15000 } } }
```

It summarizes everything except roughly the last 15k tokens and inserts the
summary in front of that tail. The adapter bridges micode's
`experimental.session.compacting` hook onto `session.hook("compaction")`, so
micode's structured summary template still shapes the result.

To compact on demand:

```sh
opencode api post /api/session/<sessionID>/compact --data '{}'
```

That endpoint returned a `compaction` message id when tested here, so manual
compaction is live even though no plugin can trigger it.

## What v2 cannot express

These are genuine gaps, not oversights:

- **A plugin cannot trigger compaction or delete a session** (see above).
  micode's child sessions are not deleted after use. Both paths log a warning
  and degrade to a no-op.
- **Per-agent `thinking.budgetTokens`** has no v2 option. micode's think mode
  still sets `thinking` on the request, but whether a provider honours it is
  now provider-dependent.
- **Per-agent tool allow/deny lists** do not exist in v2. `tools: {x: false}`
  is approximated with deny permissions, and `spawn_agent: false` (which the
  commander uses) cannot be expressed at all.
- **Session toasts** (`client.tui.showToast`) have no server-plugin equivalent;
  micode's notifications go to the log instead.
- **`ctx.$`** (the Bun shell helper) is unavailable, so any micode code path
  shelling out through it throws.

Everything else is faithful, including v2 additions micode never had to
consider:

- Per-agent `temperature` and `maxTokens` are restored through the context
  hook, since v2 has no per-agent generation fields.
- Agent models are validated against the live model registry. When micode's
  configured model is unavailable (its default is `openai/gpt-5.2-codex`), the
  agent simply inherits the session model instead of failing.
- v2's octto tools are ~20 extra tools that every request would see, because
  there is no per-agent tool filter. They stay enabled to match v1 and can be
  turned off in `~/.config/opencode/micode.jsonc`:

  ```jsonc
  { "features": { "octtoTools": false } }
  ```

## Install

```sh
git clone -b v2-adapter https://github.com/pjotrvv/micode.git ~/.micode-v2
cd ~/.micode-v2 && bun install && bun run build
```

Cloning straight into `~/.micode-v2` is what the test and upgrade commands below
assume, so the adapter is installed and maintained in one place.

`bun run build` is not optional if you want to edit micode itself — see
[Which micode gets loaded](#which-micode-gets-loaded).

Then point OpenCode at that directory in `~/.config/opencode/opencode.json`:

```json
{
  "plugins": ["~/.micode-v2"]
}
```

## Which micode gets loaded

`lib/micode.js` resolves the implementation at setup, in this order:

1. `<repo>/dist/index.js`, if it exists — your own `src/`, bundled
2. `node_modules/micode` — the published package

`dist/` is gitignored, so a clone without a build resolves to npm and behaves
exactly as before. That fallback is deliberate: the adapter is a shim around the
released plugin, not a fork of its source, so `git fetch upstream` stays clean
and a release can be picked up with `npm update micode`.

But the fallback has a sharp edge worth stating plainly. **Agent prompts are
data.** `src/agents/*.ts` holds strings handed to a model, and the model obeys
whichever copy the *loaded* bundle carries — so a prompt fixed in `src/` and
shipped from `node_modules` is a prompt that changes nothing.

That is not hypothetical. The array-form `spawn_agent` contract was corrected in
`src/agents/{executor,planner,project-initializer}.ts` while the adapter was
still loading the published bundle, which still taught the flat
`spawn_agent(agent=…, prompt=…, description=…)` form. Every one of those prompts
failed schema validation and spawned zero agents. The contract tests passed,
because they test `src/`. Batched execution ran nothing and said nothing.

So after changing anything under `src/`:

```sh
bun run build
```

`npm test` in this directory runs that build first (`pretest`), so the test
suite cannot pass against a stale `dist/`. `test/local-build.test.js` asserts
which copy is loaded and whether it teaches the current contract — it fails if
the local build stops winning, or if `dist/` drifts back to the flat form.

Startup logs which copy it took:

```
[micode-v2] loading micode from the local build; run `bun run build` to refresh it …
[micode-v2] no local build found; loading micode from node_modules …
```

No `"micode"` entry in `"plugin"` — that is the v1 key, and loading micode from
it is what produced `Plugin must export a default definition…`.

## Tests

```sh
cd ~/.micode-v2 && npm test
```

`test/harness.js` stands in for the v2 host, implementing the same shape as the
real `Context` (including the absence of `session.compact`), so the adapter and
the real upstream micode code run without a server. `test/auto-compact.test.js`
covers the compaction problem above in both directions: on a host that cannot
compact, the hook stands down; on one that can, the token counts still arrive
and the hook fires and reaches `session.compact`. `test/summarize.test.js`
covers the fail-fast behaviour above: `summarize()` rejects on a host without
compaction, and still forwards the session id when compaction is available.
`test/local-build.test.js` covers the resolution order described above: that a
local build is found, that it is the current bundle, and that it teaches the
array-form `spawn_agent` contract rather than the flat form that silently
spawned nothing.

## Status

Verified on OpenCode 2.0.21: the plugin loads with no errors, and all 26
agents, 4 commands, 41 tools, the context7 MCP server and all 6 bridged hooks
are present in the live registries (the adapter re-reads them after the
transforms to confirm). Tool execution through the wrapper is verified
separately — zod defaults applied, invalid input rejected, results mapped to
`{content}`. The four micode commands (`mindmodel`, `ledger`, `search`,
`init`) are confirmed in the live registry via `opencode api command.list` and
do appear in the TUI's `/` list. Setting `source` on
`CommandEditor.add()` was considered as a possible cause of earlier
invisibility but was not needed — the commands register and display without it.

Verified with live model round-trips (`opencode/big-pickle`). Subagent spawning
works end to end: the v1 synchronous `session.prompt` → v2 admit-and-wait shim
creates the child session, propagates its id back, surfaces provider errors
immediately instead of hanging, and delivers the child's reply to the parent. A
micode agent (`planner`) was spawned successfully this way. Permission
resolution is confirmed against `agent.list`: every micode agent seeds the
actions micode allows globally (plus `subagent`, which `spawn_agent` needs)
rather than a blanket `*:allow`, so actions micode never allows keep the host
default instead of being auto-approved. Read-only agents still carry their
`edit`/`write`/`shell`/`subagent` denies, `.env` stays `ask`, and cc-safety-net's
`browser:deny` still wins.

Not verified: a full brainstorm→plan→implement run. That needs sustained
provider capacity — `opencode/big-pickle`'s free tier rejects child sessions
with a 403 `FreeTierError` and then rate-limits, `github-copilot/*` answers
"The requested model is not supported", and `opencode-go/*` requires Global
regions. Still unproven for the same reason: micode's octto interactive tools
(`create_brainstorm`, `push_question`, `get_next_answer`,
`await_brainstorm_complete`), which cannot run headlessly at all; ledger
creation and injection; and the `/mindmodel`, `/ledger` and `/search` commands
executing. Whether micode's `system` prompts actually reach the model is
unconfirmed too — agent *registration* is verified, prompt *delivery* is not.

OpenCode's native automatic compaction has also never been observed running,
since no session has grown long enough to trigger it. micode's own
Auto-Compact trigger is deliberately off (see *Compaction*).

## Logging

Every adapter decision is logged to
`~/.local/share/opencode/log/micode-v2.log`, including registration counts,
registry verification (agents, commands and tools are re-read after the
transforms, because transforms are applied lazily when the registry is read),
and a warning for every capability v2 is missing.

## Upgrading micode

```sh
cd ~/.micode-v2 && npm update micode
```

If a future micode release migrates to the v2 plugin API, delete this
directory and use that release directly.
