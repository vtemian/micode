# micode

[![Quality Gate](https://github.com/vtemian/micode/actions/workflows/quality-gate.yml/badge.svg)](https://github.com/vtemian/micode/actions/workflows/quality-gate.yml)
[![npm version](https://badge.fury.io/js/micode.svg)](https://www.npmjs.com/package/micode)

OpenCode plugin with structured Brainstorm → Plan → Implement workflow and session continuity.

https://github.com/user-attachments/assets/85236ad3-e78a-4ff7-a840-620f6ea2f512

## Quick Start

micode loads on both OpenCode 2 and OpenCode 1 (1.18.29 or newer) from one package.

**OpenCode 2** (`~/.config/opencode/opencode.jsonc`):

```json
{ "plugins": ["micode"] }
```

**OpenCode 1, 1.18.29 or newer** (`~/.config/opencode/opencode.json`):

```json
{ "plugin": ["micode"] }
```

Then run `/init` to generate `ARCHITECTURE.md` and `CODE_STYLE.md`.

### OpenCode 2 notes

- Commands (`/init`, `/mindmodel`, `/ledger`, `/search`) switch the session's agent and keep it switched; pick another agent in the UI to switch back.
- The default agent is set to `commander` on load. Switch agents in the UI to use another one.
- Toast notifications (auto-compact, session recovery, context window) are written to the log instead of shown.
- Constraint-review violations are appended to the tool output but cannot block the call (OpenCode 2 ignores errors thrown after a tool ran).
- Agent permissions are translated to OpenCode 2's action names (`bash` becomes `shell`, the `task` tool becomes `subagent`); disabled tools are denied rather than hidden. OpenCode 2 gates the write, edit and patch tools through one `edit` action, so an agent loses writes only when both its `edit` and `write` tools are disabled.
- Your own global permission rules take precedence over micode's: a rule that asks before shell commands keeps prompting even for agents micode allows to run them.
- Per-agent `temperature`, `maxTokens` and `thinking` (Anthropic models only) are applied to each request.
- Fragments, the continuity ledger and project context files are injected into the system prompt on both hosts (on OpenCode 1 they previously never reached the model).
- The default model is `openai/gpt-5.3-codex`; override it per agent in `micode.json` as before. An override without a provider prefix (for example `gpt-5`) is ignored with a warning and the agent uses OpenCode's default model.

## Workflow

```
Brainstorm → Plan → Implement
     ↓         ↓        ↓
  research  research  executor
```

### Brainstorm
Refine ideas into designs through collaborative questioning. Fires research subagents in parallel. Output: `thoughts/shared/designs/YYYY-MM-DD-{topic}-design.md`

### Plan  
Transform designs into implementation plans with bite-sized tasks (2-5 min each), exact file paths, and TDD workflow. Output: `thoughts/shared/plans/YYYY-MM-DD-{topic}.md`

### Implement
Execute in git worktree for isolation. The **Executor** orchestrates implementer→reviewer cycles with parallel execution via fire-and-check pattern.

### Session Continuity
Maintain context across sessions with structured compaction. Run `/ledger` to create/update `thoughts/ledgers/CONTINUITY_{session}.md`.

## Commands

| Command | Description |
|---------|-------------|
| `/init` | Initialize project docs |
| `/ledger` | Create/update continuity ledger |
| `/search` | Search past plans and ledgers |

## Agents

| Agent | Purpose |
|-------|---------|
| commander | Orchestrator |
| brainstormer | Design exploration |
| planner | Implementation plans |
| executor | Orchestrate implement→review |
| implementer | Execute tasks |
| reviewer | Check correctness |
| codebase-locator | Find file locations |
| codebase-analyzer | Deep code analysis |
| pattern-finder | Find existing patterns |
| project-initializer | Generate project docs |
| ledger-creator | Continuity ledgers |
| artifact-searcher | Search past work |

## Tools

| Tool | Description |
|------|-------------|
| `ast_grep_search` | AST-aware code pattern search |
| `ast_grep_replace` | AST-aware code pattern replacement |
| `look_at` | Extract file structure |
| `artifact_search` | Search past plans/ledgers |
| `btca_ask` | Query library source code |
| `pty_spawn` | Start background terminal session |
| `pty_write` | Send input to PTY |
| `pty_read` | Read PTY output |
| `pty_list` | List PTY sessions |
| `pty_kill` | Terminate PTY |

## Hooks

- **Think Mode** - Keywords like "think hard" enable 128k token thinking budget
- **Ledger Loader** - Injects continuity ledger into system prompt
- **Auto-Compact** - At 50% context usage, automatically summarizes session to reduce context
- **File Ops Tracker** - Tracks read/write/edit for deterministic logging
- **Artifact Auto-Index** - Indexes artifacts in thoughts/ directories
- **Context Injector** - Injects ARCHITECTURE.md, CODE_STYLE.md
- **Token-Aware Truncation** - Truncates large tool outputs

## Configuration

### Model Configuration

micode reads your default model from `opencode.json`:

```json
{
  "model": "github-copilot/gpt-5-mini",
  "plugin": ["micode"]
}
```

All micode agents will use this model automatically.

### micode.json

Create `~/.config/opencode/micode.json` for micode-specific settings:

```jsonc
{
  "agents": {
    "brainstormer": { "model": "openai/gpt-4o", "temperature": 0.8 },
    "commander": {
      "maxTokens": 8192,
      // Configure reasoning effort per agent
      "thinking": { "type": "enabled", "budgetTokens": 100000 }
    }
  },
  "features": {
    "mindmodelInjection": true,
    "context7": false
  },
  "compactionThreshold": 0.5,
  "fragments": {
    "commander": ["custom-instructions.md"]
  }
}
```

> **Note:** Both `.json` and `.jsonc` formats are supported. JSONC allows comments and trailing commas.

#### Options

| Option | Type | Description |
|--------|------|-------------|
| `agents` | object | Per-agent overrides (model, temperature, maxTokens, thinking) |
| `features.mindmodelInjection` | boolean | Enable mindmodel context injection |
| `features.context7` | boolean | Register the bundled context7 MCP server. Set `false` when it already comes from another tool or proxy. Default: `true` |
| `compactionThreshold` | number | Context usage threshold (0-1) for auto-compaction. Default: 0.7 |
| `fragments` | object | Additional prompt fragments per agent |

#### Model Resolution Priority

1. Per-agent override in `micode.json` (highest)
2. Default model from `opencode.json` `"model"` field
3. Plugin default (fallback)

#### Model Syntax

Models use `provider/model` format. The provider must match exactly what's in your `opencode.json`:

```json
{
  "provider": {
    "github-copilot": {
      "models": { "gpt-5-mini": {} }
    }
  }
}
```

Use `"model": "github-copilot/gpt-5-mini"` (not `github/copilot:gpt-5-mini`).

## Development

```bash
git clone git@github.com:vtemian/micode.git ~/.micode
cd ~/.micode && bun install && bun run build
```

```json
// OpenCode 2: an absolute directory path, resolved through the root index.js
{ "plugins": ["/Users/you/.micode"] }
// OpenCode 1
{ "plugin": ["~/.micode"] }
```

### Release

```bash
npm version patch  # or minor, major
git push --follow-tags
```

## Philosophy

1. **Brainstorm first** - Refine ideas before coding
2. **Research before implementing** - Understand the codebase
3. **Plan with human buy-in** - Get approval before coding
4. **Parallel investigation** - Spawn multiple subagents
5. **Isolated implementation** - Use git worktrees
6. **Continuous verification** - Implementer + Reviewer per task
7. **Session continuity** - Never lose context

## micode vs oh-my-opencode

Both are OpenCode plugins, but with different philosophies:

| Aspect | micode | oh-my-opencode |
|--------|--------|----------------|
| **Philosophy** | Opinionated workflow (brainstorm→plan→implement) | Batteries-included framework |
| **Agent Design** | Role-based (Brainstormer, Planner, Executor) | Greek mythology theme (Sisyphus, Atlas, Prometheus) |
| **Parallelism** | Batch-first: 10-20 concurrent micro-tasks (2-5 min each) | Background tasks with tmux visual monitoring |
| **Code Guidance** | Mindmodel system with project-specific patterns | Comment checker, keyword modes (ultrawork) |
| **Context Recovery** | Ledger system (CONTINUITY files) | AGENTS.md hierarchy, preemptive compaction |
| **Workflow** | TDD-enforced with adaptation over escalation | Category-based delegation (visual-engineering, ultrabrain) |
| **Configuration** | Focused options | Extensive (34 hooks, 11 agents, fallback chains) |

### When to Choose micode

- You want a **structured brainstorm→plan→implement workflow**
- You prefer **TDD-driven implementation** with test-first development
- You need **project-specific pattern enforcement** via mindmodel
- You want **high parallelism on granular tasks** (10-20 concurrent micro-tasks)
- You value **session continuity** via structured ledgers

### When to Choose oh-my-opencode

- You want **maximum flexibility** and configuration options
- You prefer **keyword-driven modes** (e.g., "ultrawork", "analyze")
- You need **extensive model fallback chains** with subscription detection
- You like **category-based task delegation** (visual-engineering, infrastructure)
- You want **visual monitoring** via tmux integration

## Inspiration

- [oh-my-opencode](https://github.com/code-yeongyu/oh-my-opencode) - Plugin architecture
- [HumanLayer ACE-FCA](https://github.com/humanlayer/12-factor-agents) - Structured workflows
- [Factory.ai](https://factory.ai/blog/context-compression) - Structured compaction research
