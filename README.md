# micode

[![CI](https://github.com/vtemian/micode/actions/workflows/ci.yml/badge.svg)](https://github.com/vtemian/micode/actions/workflows/ci.yml)
[![npm version](https://badge.fury.io/js/micode.svg)](https://www.npmjs.com/package/micode)

OpenCode plugin with a structured Brainstorm → Plan → Implement workflow and session continuity.


https://github.com/user-attachments/assets/85236ad3-e78a-4ff7-a840-620f6ea2f512


## Installation

Add to `~/.config/opencode/opencode.json`:

```json
{
  "plugin": ["micode"]
}
```

**AI-assisted install:** Share [INSTALL_CLAUDE.md](./INSTALL_CLAUDE.md) with your AI assistant for guided setup.

## Getting Started

**Important:** Run `/init` first to generate project documentation:

```
/init
```

This creates `ARCHITECTURE.md` and `CODE_STYLE.md` which agents reference during brainstorming, planning, and implementation. Without these files, agents lack context about your codebase patterns.

## Workflow

```
Brainstorm → Plan → Implement
     ↓         ↓        ↓
  research  research  executor
```

Research subagents (codebase-locator, codebase-analyzer, pattern-finder) are spawned within brainstorm and plan phases - not as a separate step.

### 1. Brainstorm

Refine rough ideas into fully-formed designs through collaborative questioning.

- One question at a time (critical rule!)
- 2-3 approaches with trade-offs
- Section-by-section validation
- Fires research subagents in parallel via `background_task`
- Auto-hands off to planner when user approves
- Output: `thoughts/shared/designs/YYYY-MM-DD-{topic}-design.md`

**Research subagents** (fired in parallel via background_task):

| Subagent | Purpose |
|----------|---------|
| `codebase-locator` | Find WHERE files live (paths, no content) |
| `codebase-analyzer` | Explain HOW code works (with file:line refs) |
| `pattern-finder` | Find existing patterns to follow |

**Auto-handoff:** When user approves the design, brainstormer automatically spawns the planner - no extra confirmation needed.

### 2. Plan

Transform validated designs into comprehensive implementation plans.

- Fires research subagents in parallel via `background_task`
- Uses `context7` and `btca_ask` for external library documentation
- Bite-sized tasks (2-5 minutes each)
- Exact file paths, complete code examples
- TDD workflow: failing test → verify fail → implement → verify pass → commit
- Get human approval before implementing
- Output: `thoughts/shared/plans/YYYY-MM-DD-{topic}.md`

**Library research tools:**

| Tool | Purpose |
|------|---------|
| `context7` | Documentation lookup for external libraries |
| `btca_ask` | Source code search for library internals |

### 3. Implement

Execute plan in git worktree for isolation:

```bash
git worktree add ../{feature} -b feature/{feature}
```

The **Executor** orchestrates task execution with intelligent parallelization:

#### How It Works

1. **Parse** - Extract individual tasks from the plan
2. **Analyze** - Build dependency graph between tasks
3. **Batch** - Group independent tasks for parallel execution
4. **Execute** - Run implementer→reviewer cycle per task
5. **Aggregate** - Collect results and report status

#### Dependency Analysis

Tasks are grouped into batches based on their dependencies:

```
Independent tasks (can parallelize):
- Modify different files
- Don't depend on each other's output
- Don't share state

Dependent tasks (must be sequential):
- Task B modifies a file Task A creates
- Task B imports something Task A defines
- Task B's test relies on Task A's implementation
```

#### Parallel Execution (Fire-and-Check Pattern)

The executor uses a **fire-and-check** pattern for maximum parallelism:

1. **Fire** - Launch all implementers as `background_task` in ONE message
2. **Poll** - Check `background_list` for completions
3. **React** - Start reviewer immediately when each implementer finishes
4. **Repeat** - Continue polling until batch complete

```
Plan with 6 tasks:
├── Batch 1 (parallel): Tasks 1, 2, 3 → independent, different files
│   │
│   │ FIRE: background_task(agent="implementer") x3
│   │
│   │ POLL: background_list() → task 2 completed!
│   │ → background_output(task_2)
│   │ → background_task(agent="reviewer", "Review task 2")
│   │
│   │ POLL: background_list() → tasks 1, 3 completed!
│   │ → start reviewers for 1 and 3
│   │
│   │ [continue until all reviewed]
│
└── Batch 2 (parallel): Tasks 4, 5, 6 → depend on batch 1
    └── [same pattern]
```

Key: Reviewers start **immediately** when their implementer finishes - no waiting for the whole batch.

#### Per-Task Cycle

Each task gets its own implement→review loop:

1. Fire implementer via `background_task`
2. Implementer: make changes → run tests → **commit** if passing
3. Fire reviewer to check implementation
4. If changes requested → fire new implementer (max 3 cycles)
5. Mark as DONE or BLOCKED

**Note:** Implementer commits after verification passes, using the commit message from the plan.

### 4. Session Continuity

Maintain context across long sessions and context clears with structured compaction:

#### Ledger System

The **continuity ledger** serves as both session state and compaction summary. Based on [Factory.ai's structured compaction research](https://factory.ai/blog/context-compression), which found that structured summarization with deterministic file tracking retains more useful context.

```
/ledger
```

Creates/updates `thoughts/ledgers/CONTINUITY_{session-name}.md` with:

```markdown
# Session: {name}
Updated: {timestamp}

## Goal
## Constraints
## Progress
### Done
- [x] {Completed items}
### In Progress
- [ ] {Current work}
### Blocked
- {Issues, if any}
## Key Decisions
- **{Decision}**: {Rationale}
## Next Steps
1. {Ordered list}
## File Operations
### Read
- `{paths read since last compaction}`
### Modified
- `{paths written/edited since last compaction}`
## Critical Context
- {Data, examples, references needed to continue}
```

**Key features:**

- **Iterative merging** - Updates preserve existing information, adding new progress rather than regenerating from scratch
- **Deterministic file tracking** - Read/write/edit operations tracked automatically via tool call interception, not LLM extraction
- **Auto-injection** - Most recent ledger injected into system prompt on session start

**Auto-clear:** At 80% context usage, the system automatically:
1. Captures file operations tracked since last clear
2. Updates ledger with current state (iterative merge with previous)
3. Clears the session
4. Injects the updated ledger into fresh context

#### Artifact Search

Search past work to find relevant precedent:

```
/search oauth authentication
/search JWT tokens
```

Searches across:
- Ledgers (`thoughts/ledgers/`)
- Plans (`thoughts/shared/plans/`)

**Auto-indexing:** Artifacts are automatically indexed when created.

## Commands

| Command | Description |
|---------|-------------|
| `/init` | Initialize project with ARCHITECTURE.md and CODE_STYLE.md |
| `/ledger` | Create or update continuity ledger for session state |
| `/search` | Search past plans and ledgers |

## Agents

| Agent | Mode | Model | Purpose |
|-------|------|-------|---------|
| commander | primary | claude-opus-4-5 | Orchestrator, delegates to specialists |
| brainstormer | primary | claude-opus-4-5 | Design exploration through questioning |
| project-initializer | subagent | claude-opus-4-5 | Generate ARCHITECTURE.md and CODE_STYLE.md |
| codebase-locator | subagent | claude-sonnet | Find file locations |
| codebase-analyzer | subagent | claude-sonnet | Deep code analysis |
| pattern-finder | subagent | claude-sonnet | Find existing patterns |
| planner | subagent | claude-opus-4-5 | Create detailed implementation plans |
| executor | subagent | claude-opus-4-5 | Orchestrate implement → review cycle |
| implementer | subagent | claude-opus-4-5 | Execute implementation tasks |
| reviewer | subagent | claude-opus-4-5 | Review correctness and style |
| ledger-creator | subagent | claude-sonnet | Create/update continuity ledgers |
| artifact-searcher | subagent | claude-sonnet | Search past work for precedent |

## Tools

| Tool | Description |
|------|-------------|
| `ast_grep_search` | AST-aware code pattern search |
| `ast_grep_replace` | AST-aware code pattern replacement |
| `look_at` | Extract file structure for large files |
| `artifact_search` | Search past plans and ledgers |
| `btca_ask` | Query library source code (requires btca CLI) |
| `background_task` | Fire subagent to run in background, returns task_id |
| `background_list` | List all tasks and status (use to poll for completion) |
| `background_output` | Get results from completed task |
| `background_cancel` | Cancel running task(s) |

### Background Task Pattern

All agents use the **fire-poll-collect** pattern for parallel work:

```
# FIRE: Launch all in ONE message
task_1 = background_task(agent="locator", prompt="...")
task_2 = background_task(agent="analyzer", prompt="...")

# POLL: Check until complete
background_list()  # repeat until all show "completed"

# COLLECT: Get results
background_output(task_id=task_1)
background_output(task_id=task_2)
```

## Hooks

| Hook | Description |
|------|-------------|
| Think Mode | Keywords like "think hard" enable 32k token thinking budget |
| Ledger Loader | Injects continuity ledger into system prompt |
| Auto-Clear Ledger | At 80% context, saves ledger with file ops and clears session |
| File Ops Tracker | Tracks read/write/edit tool calls for deterministic file operation logging |
| Artifact Auto-Index | Indexes artifacts when written to thoughts/ directories |
| Auto-Compact | Summarizes session when hitting token limits |
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

| Server | Description | Activation |
|--------|-------------|------------|
| context7 | Documentation lookup | Always enabled |
| perplexity | Web search | Set `PERPLEXITY_API_KEY` |
| firecrawl | Web crawling | Set `FIRECRAWL_API_KEY` |

## Structure

```
micode/
├── src/
│   ├── agents/       # Agent definitions
│   ├── tools/        # ast-grep, look-at, artifact-search, background-task
│   ├── hooks/        # Session management hooks
│   └── index.ts      # Plugin entry
├── dist/             # Built plugin
└── thoughts/         # Artifacts (gitignored)
    ├── ledgers/        # Continuity ledgers
    └── shared/
        ├── designs/    # Brainstorm outputs
        └── plans/      # Implementation plans
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
  "plugin": ["~/.micode"]
}
```

### Commands

```bash
bun install       # Install dependencies
bun run build     # Build plugin
bun run typecheck # Type check
bun test          # Run tests
bun test --watch  # Run tests in watch mode
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
7. **Session continuity** - Never lose context across clears

## Inspiration

Built on techniques from:

- **[oh-my-opencode](https://github.com/code-yeongyu/oh-my-opencode)** - OpenCode plugin architecture, agent orchestration patterns, and trusted publishing setup
- **[HumanLayer ACE-FCA](https://github.com/humanlayer/12-factor-agents)** - Advanced Context Engineering for Coding Agents, structured workflows, and the research → plan → implement methodology
- **[Factory.ai Context Compression](https://factory.ai/blog/context-compression)** - Structured compaction research showing that anchored iterative summarization with deterministic file tracking outperforms generic compression
