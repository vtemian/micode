# micode

[![CI](https://github.com/vtemian/micode/actions/workflows/ci.yml/badge.svg)](https://github.com/vtemian/micode/actions/workflows/ci.yml)
[![npm version](https://badge.fury.io/js/micode.svg)](https://www.npmjs.com/package/micode)

OpenCode plugin with a structured Brainstorm → Research → Plan → Implement workflow.

## Installation

Add to `~/.config/opencode/opencode.json`:

```json
{
  "plugin": ["micode"]
}
```

**AI-assisted install:** Share [INSTALL_CLAUDE.md](./INSTALL_CLAUDE.md) with your AI assistant for guided setup.

## Workflow

```
Brainstorm → Research → Plan → Implement → Review
```

### 1. Brainstorm

Refine rough ideas into fully-formed designs through collaborative questioning.

- One question at a time
- 2-3 approaches with trade-offs
- Section-by-section validation
- Output: `thoughts/shared/designs/YYYY-MM-DD-{topic}-design.md`

### 2. Research

Parallel codebase investigation using specialized subagents:

| Subagent | Purpose |
|----------|---------|
| `codebase-locator` | Find WHERE files live (paths, no content) |
| `codebase-analyzer` | Explain HOW code works (with file:line refs) |
| `pattern-finder` | Find existing patterns to follow |

Output: `thoughts/shared/research/YYYY-MM-DD-{topic}.md`

### 3. Plan

Transform validated designs into comprehensive implementation plans.

- Bite-sized tasks (2-5 minutes each)
- Exact file paths, complete code examples
- TDD workflow: failing test → verify fail → implement → verify pass → commit
- Get human approval before implementing
- Output: `thoughts/shared/plans/YYYY-MM-DD-{topic}.md`

### 4. Implement

Execute plan in git worktree for isolation:

```bash
git worktree add ../{feature} -b feature/{feature}
```

- **Executor** orchestrates the implement → review cycle automatically
- Spawns Implementer → waits → spawns Reviewer → loops if changes requested
- Maximum 3 cycles before escalating to human
- Commit with descriptive messages when approved

### 5. Handoff

Save/resume session state for continuity:

- `handoff-creator`: Save current session
- `handoff-resumer`: Resume from handoff
- Output: `thoughts/shared/handoffs/`

## Commands

| Command | Description |
|---------|-------------|
| `/init` | Initialize project with ARCHITECTURE.md and CODE_STYLE.md |

## Agents

| Agent | Mode | Model | Purpose |
|-------|------|-------|---------|
| Commander | primary | claude-opus-4-5 | Orchestrator, delegates to specialists |
| Brainstormer | primary | claude-opus-4-5 | Design exploration through questioning |
| project-initializer | subagent | claude-opus-4-5 | Generate ARCHITECTURE.md and CODE_STYLE.md |
| codebase-locator | subagent | - | Find file locations |
| codebase-analyzer | subagent | - | Deep code analysis |
| pattern-finder | subagent | - | Find existing patterns |
| planner | subagent | claude-opus-4-5 | Create detailed implementation plans |
| executor | subagent | claude-opus-4-5 | Orchestrate implement → review cycle |
| implementer | subagent | claude-opus-4-5 | Execute implementation tasks |
| reviewer | subagent | claude-opus-4-5 | Review correctness and style |
| handoff-creator | subagent | - | Save session state |
| handoff-resumer | subagent | - | Resume from handoff |

## Tools

| Tool | Description |
|------|-------------|
| `ast_grep_search` | AST-aware code pattern search |
| `ast_grep_replace` | AST-aware code pattern replacement |
| `look_at` | Screenshot analysis |
| `background_task` | Run long-running tasks in background |
| `check_background_task` | Check background task status |

## Hooks

| Hook | Description |
|------|-------------|
| Think Mode | Keywords like "think hard" enable 32k token thinking budget |
| Auto-Compact | Summarizes session when hitting token limits |
| Preemptive Compaction | Warns before context exhaustion |
| Context Injector | Injects ARCHITECTURE.md, CODE_STYLE.md, .cursorrules |
| Token-Aware Truncation | Truncates large tool outputs |
| Context Window Monitor | Tracks token usage |
| Comment Checker | Validates edit tool comments |
| Session Recovery | Recovers from crashes |

## Permissions

All permissions are set to `allow` globally - no prompts for tool usage:

```typescript
config.permission = {
  edit: "allow",
  bash: "allow",
  webfetch: "allow",
  doom_loop: "allow",
  external_directory: "allow",
};
```

This enables subagents to work autonomously without getting stuck on permission prompts.

## MCP Servers

| Server | Description |
|--------|-------------|
| context7 | Documentation lookup |

## Structure

```
micode/
├── src/
│   ├── agents/       # Agent definitions
│   ├── tools/        # ast-grep, look-at, background-task
│   ├── hooks/        # Session management hooks
│   └── index.ts      # Plugin entry
├── dist/             # Built plugin
└── thoughts/         # Artifacts (gitignored)
    └── shared/
        ├── designs/    # Brainstorm outputs
        ├── research/   # Research documents
        ├── plans/      # Implementation plans
        └── handoffs/   # Session handoffs
```

## Development

### From source

```bash
git clone git@github.com:vtemian/micode.git ~/.micode
cd ~/.micode
bun install
bun run build
```

Then use local path in config:
```json
{
  "plugin": ["~/.micode/dist/index.js"]
}
```

### Commands

```bash
bun install       # Install dependencies
bun run build     # Build plugin
bun run typecheck # Type check
```

### Release

Releases are automated via GitHub Actions. To publish a new version:

```bash
npm version patch  # or minor, major
git push --follow-tags
```

This triggers the release workflow which publishes to npm.

**Manual publish** (first time or if needed):
```bash
npm login
npm publish
```

## Philosophy

1. **Brainstorm first** - Refine ideas before coding
2. **Research before implementing** - Understand the codebase
3. **Plan with human buy-in** - Get approval before coding
4. **Parallel investigation** - Spawn multiple subagents for speed
5. **Isolated implementation** - Use git worktrees for features
6. **Continuous verification** - Implementer + Reviewer per phase

## Inspiration

Built on techniques from:

- **[oh-my-opencode](https://github.com/code-yeongyu/oh-my-opencode)** - OpenCode plugin architecture, agent orchestration patterns, and trusted publishing setup
- **[HumanLayer ACE-FCA](https://github.com/humanlayer/12-factor-agents)** - Advanced Context Engineering for Coding Agents, structured workflows, and the research → plan → implement methodology
