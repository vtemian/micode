# micode end-to-end tests

Modeled on octto's e2e suite: everything is real except the model. opencode
runs the built plugin (`dist/index.js`) exactly as users load it, tool calls
execute for real, and files land in a copied fixture project on disk. The one
fake is the model, replaced by a scripted OpenAI-compatible stub, so a run is
deterministic, free and takes seconds instead of minutes.

## Tiers

| Tier | Command | Model | Runs |
| --- | --- | --- | --- |
| Scripted | `bun run test:e2e` | stub provider | every PR (Docker) |
| Live | `bun run test:e2e:live` | real free-tier model | manual (`workflow_dispatch`) |

The scripted tier cannot catch prompt-adherence bugs (a script always
"adheres"), which is what the live tier in `tests/e2e/` is for. Keep both.

## Layout

- `e2e/stub-provider/server.ts` — the scripted chat-completions server
- `e2e/specs/harness.ts` — stub lifecycle, isolated HOME, opencode spawn, drain
- `e2e/specs/*.test.ts` — the specs (`bun test e2e/specs` inside the image)
- `e2e/scripts/*.json` — conversation scripts
- `e2e/Dockerfile` — bun + opencode CLI; `bun run test:e2e` builds and runs it

## Regression specs

Specs named `issue-NN-*.test.ts` reproduce a reported bug end to end, with the
bug anatomy in the file header. They assert the FIXED behavior, so they fail
while the bug is open and become regression guards once it lands. Do not merge
them red: replicate on a branch, fix, then merge green.

## Scripts

A script is `{ "conversations": [...] }`. micode's flows fan out into parallel
subagent sessions (spawn_agent), so the stub picks a conversation per request
by matching `match` (a substring unique to that agent's system prompt) against
the serialized request messages. Turn N answers the request carrying N prior
assistant messages, keeping the stub stateless and retry-safe. A turn is
`{ "text": ... }`, `{ "tool": ..., "args": ... }`, or both (an assistant
message with content and a tool call, which real models emit and a child
session needs: a text-only turn ends it). A single conversation may omit
`match` and becomes the default for unmatched requests (title generation, the
primary session's wrap-up turn); past the end of a conversation the stub
answers "Script exhausted." so opencode stops instead of looping.

Markers for the mindmodel agents are the role lines in their system prompts,
e.g. "detecting project tech stack" (mm-stack-detector). Args support
`{ "$extract": "<regex>" }`, replaced by the last regex match seen in the
conversation so far, for runtime-minted ids.

## Platform notes

- The opencode CLI is installed at image build time; the image is the
  isolation boundary, so ports are pinned (`STUB_PORT`, default 8787).
- Each spec gets a fresh `mkdtemp` HOME (opencode derives every XDG path from
  it) and writes opencode.json (stub provider, plugin by absolute path) plus
  micode.json (`features.context7: false`, or every cold HOME npx-downloads
  the context7 server for nothing).
- The spec env is an explicit allowlist (PATH, HOME, OPENCODE_DISABLE_*), never
  `...process.env`: an ambient OPENAI_API_KEY would silently enable providers.
- Cold HOMEs make opencode install `@opencode-ai/plugin` at runtime, so the
  container needs network and the generous run timeouts are mostly npm latency.
- Clean up temp dirs before asserting in after hooks: an assertion failure must
  not skip `rmSync`, or a failing spec leaks tens of MB per run.
