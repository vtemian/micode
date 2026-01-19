# mindmodel v2: Constraint-Guided Generation

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or superpowers:subagent-driven-development to implement this design.

**Goal:** Evolve mindmodel from "selective few-shot injection" to "constraint-guided generation with enforcement" - inspired by Lovable's approach of narrowing the solution space.

**Architecture:** Deep codebase analysis extracts constraints (rules + examples + anti-patterns). Constraints are injected during generation. Post-generation review catches violations with automatic retry.

**Tech Stack:** TypeScript, micode plugin hooks, subagent orchestration

---

## Overview

### Core Philosophy

- `/init` deeply analyzes your codebase and extracts constraints
- Constraints are injected as context so the agent naturally follows them
- Post-generation review catches violations
- Block with explanation, automatic retry once, explicit override if needed

### Key Differences from v1

| Aspect | v1 (Current) | v2 |
|--------|--------------|-----|
| Analysis depth | Surface scan | Full codebase analysis |
| Constraint scope | Examples only | Rules + examples + anti-patterns |
| Enforcement | None (guidance only) | Post-generation review with blocking |
| Retry | None | Automatic retry once on violation |
| Override | N/A | Explicit with reason, logged |
| Update mechanism | Re-run /init | Manual edit or /init --update |

### The Constraint Loop

```
/init → Deep analysis → .mindmodel/ generated
                              ↓
Task → Classify → Inject relevant constraints → Generate
                              ↓
                    Review against constraints
                              ↓
              PASS → proceed | BLOCK → retry once → PASS/BLOCK
                                                        ↓
                                          Show violations, allow override
```

---

## Constraint Categories & Structure

### 26 Categories Organized by Concern

```
.mindmodel/
├── manifest.yaml                 # Index of all categories
├── system.md                     # Project overview (always loaded)
│
├── stack/                        # Tech & Architecture
│   ├── frontend.md               # Frameworks, libraries, versions
│   ├── backend.md
│   ├── database.md
│   └── dependencies.md           # Approved/forbidden libraries
│
├── architecture/
│   ├── layers.md                 # How layers communicate
│   ├── organization.md           # Directory structure, modules
│   └── contracts.md              # API versioning, compatibility
│
├── patterns/                     # Implementation Patterns
│   ├── error-handling.md
│   ├── logging.md
│   ├── validation.md
│   ├── auth.md
│   ├── data-fetching.md
│   ├── state-management.md
│   ├── testing.md
│   └── config.md                 # Env vars, secrets
│
├── style/                        # Code Style
│   ├── naming.md
│   ├── comments.md
│   ├── types.md
│   └── imports.md
│
├── components/                   # Reusable Components
│   ├── ui.md                     # Frontend components
│   ├── shared.md                 # Utilities, helpers
│   └── base.md                   # Base classes, interfaces
│
├── domain/                       # Project-Specific
│   ├── concepts.md               # Business terminology
│   ├── integrations.md           # Third-party APIs
│   └── performance.md            # Caching, optimization
│
└── ops/
    ├── database.md               # Migrations, queries, ORM
    └── build.md                  # Build commands, CI
```

### File Format

Each constraint file contains rules, examples, and anti-patterns:

```markdown
# Error Handling

## Rules
- Always wrap errors with context using fmt.Errorf and %w
- Never swallow errors silently
- Log at the boundary, not in helpers

## Examples

### Wrapping errors
```go
if err != nil {
    return fmt.Errorf("failed to fetch user: %w", err)
}
```

## Anti-patterns

### Don't swallow errors
```go
// BAD: swallowing error
if err != nil {
    return nil
}
```
```

### Selective Loading

Only 2-3 relevant constraint files are loaded per task via LLM classification. Never load everything at once - too much context degrades output quality.

---

## /init Analysis Pipeline

### Deep Analysis Through Multi-Phase Agent Pipeline

```
/init
  │
  ▼
Phase 1: Discovery (parallel)
┌────────────────┬────────────────┬────────────────┬────────────────┐
│ stack-detector │ dependency-    │ convention-    │ domain-        │
│                │ mapper         │ extractor      │ extractor      │
│ Reads configs, │ Maps imports,  │ Analyzes       │ Extracts       │
│ package files  │ finds approved │ naming, style  │ business terms │
│                │ vs one-off     │ across files   │ from types     │
└────────────────┴────────────────┴────────────────┴────────────────┘
                              │
                              ▼
Phase 2: Pattern Analysis (parallel)
┌────────────────┬────────────────┬────────────────┐
│ code-clusterer │ pattern-       │ anti-pattern-  │
│                │ discoverer     │ detector       │
│ Groups similar │ Identifies     │ Finds          │
│ code (all API  │ common         │ inconsistencies│
│ calls, all     │ patterns per   │ "80% do X,     │
│ error handling)│ category       │ 20% do Y"      │
└────────────────┴────────────────┴────────────────┘
                              │
                              ▼
Phase 3: Extraction (parallel per category)
┌────────────────┬────────────────┬────────────────┐
│ example-       │ example-       │ example-       │
│ extractor      │ extractor      │ extractor      │
│ (patterns/)    │ (components/)  │ (style/)       │
│                │                │                │
│ Picks best     │ Picks best     │ Picks best     │
│ examples, adds │ examples, adds │ examples, adds │
│ anti-patterns  │ anti-patterns  │ anti-patterns  │
└────────────────┴────────────────┴────────────────┘
                              │
                              ▼
Phase 4: Assembly
┌──────────────────────────────────────────────────┐
│ constraint-writer                                 │
│                                                  │
│ Combines all outputs into .mindmodel/ structure  │
│ Generates manifest.yaml with descriptions        │
│ Writes system.md overview                        │
└──────────────────────────────────────────────────┘
```

### New Agents

| Agent | Purpose |
|-------|---------|
| dependency-mapper | Maps imports across codebase, identifies approved libraries vs one-off usage |
| convention-extractor | Analyzes naming conventions, import style, file structure across many files |
| domain-extractor | Reads types, comments, variable names to build business terminology glossary |
| code-clusterer | Groups similar code (all error handling, all API calls) to find patterns |
| anti-pattern-detector | Finds inconsistencies ("80% of files do X, but 3 files do Y") |
| constraint-writer | Assembles all analysis into .mindmodel/ structure |

---

## Enforcement & Review

### Post-Generation Review

Every Edit/Write operation is reviewed against constraints:

```
Agent generates code
        │
        ▼
┌──────────────────────────────────────────────────┐
│ constraint-reviewer                               │
│                                                  │
│ Inputs:                                          │
│ - Generated code (diff or full file)             │
│ - Relevant constraint files (same as generator)  │
│ - Original task                                  │
│                                                  │
│ Checks:                                          │
│ - Stack violations (wrong libraries)             │
│ - Pattern deviations (didn't follow conventions) │
│ - Missing reuse (wrote custom, should use shared)│
│ - Style violations (naming, imports, types)      │
│ - Anti-patterns (did something explicitly bad)   │
└──────────────────────────────────────────────────┘
        │
        ▼
    PASS → code proceeds to user
        │
    BLOCK → automatic retry with violations as feedback
        │
        ▼
    Second review
        │
        ▼
    PASS → code proceeds
        │
    BLOCK → show to user with explanation
```

### Block Message Format

```
❌ Blocked: This code violates project constraints:
- Used axios instead of project's fetch wrapper (see patterns/data-fetching.md)
- Missing error context wrapping (see patterns/error-handling.md)
```

### Override Mechanism

User can explicitly override with reason:
```
override: one-off script, not production code
```

Overrides are logged to `.mindmodel/overrides.log`:
```
2024-01-19 14:32 | override patterns/data-fetching.md | reason: "one-off script, not production code"
```

---

## Integration with micode

### Hook Integration Points

```typescript
// 1. Classification hook (existing, enhanced)
"chat.params": async (input, output) => {
  const mindmodel = await loadMindmodel(ctx.directory);
  if (!mindmodel) return;

  // Classify and inject relevant constraints
  const categories = await classifyTask(input.messages, mindmodel.manifest);
  const constraints = await loadConstraints(mindmodel, categories);
  output.system = formatConstraints(constraints) + output.system;
}

// 2. NEW: Post-generation review hook
"tool.execute.after": async (input, output) => {
  if (!["Edit", "Write"].includes(input.tool)) return;

  const violations = await reviewConstraints(output, loadedConstraints);

  if (violations.length > 0) {
    if (!hasRetried) {
      // Automatic retry
      return retryWithFeedback(violations);
    }
    // Block with explanation
    throw new ConstraintViolation(violations);
  }
}

// 3. NEW: Override handler
"chat.message": async (input, output) => {
  if (isOverrideCommand(input)) {
    logOverride(input.reason);
    allowNextViolation();
  }
}
```

### Config Additions

```typescript
// src/utils/config.ts
mindmodel: {
  overrideLogFile: "overrides.log",
  reviewMaxRetries: 1,
  reviewEnabled: true,
}
```

### New Agents to Register

```typescript
// src/agents/index.ts
"mm-dependency-mapper": dependencyMapperAgent,
"mm-convention-extractor": conventionExtractorAgent,
"mm-domain-extractor": domainExtractorAgent,
"mm-code-clusterer": codeClustererAgent,
"mm-anti-pattern-detector": antiPatternDetectorAgent,
"mm-constraint-writer": constraintWriterAgent,
"mm-constraint-reviewer": constraintReviewerAgent,
```

---

## Implementation Scope

### In Scope (v2)

1. **Enhanced /init command** with deep analysis pipeline (6 new agents)
2. **New constraint structure** - 26 categories across stack/patterns/style/components/domain/ops
3. **constraint-reviewer agent** - post-generation review on every Edit/Write
4. **Enforcement flow** - block → auto-retry once → show violations → allow override
5. **Override logging** - track all explicit overrides

### Out of Scope (Future)

- Parallel multi-file generation with parallel review
- Automatic constraint suggestions from override patterns
- Learning mode (track approved patterns, suggest updates)
- Embedding-based classification (currently LLM-only)

---

## New Agents Summary

| Agent | Mode | Purpose |
|-------|------|---------|
| mm-dependency-mapper | subagent | Maps imports, finds approved vs one-off libraries |
| mm-convention-extractor | subagent | Analyzes naming, style across codebase |
| mm-domain-extractor | subagent | Extracts business terms from types/comments |
| mm-code-clusterer | subagent | Groups similar code to find patterns |
| mm-anti-pattern-detector | subagent | Finds inconsistencies in codebase |
| mm-constraint-writer | subagent | Assembles .mindmodel/ from analysis |
| mm-constraint-reviewer | subagent | Reviews generated code against constraints |

---

## Success Criteria

1. `/init` generates comprehensive `.mindmodel/` with all 26 categories populated where applicable
2. Classifier accurately picks 2-3 relevant constraints per task
3. Reviewer catches >90% of constraint violations
4. Automatic retry fixes >80% of caught violations
5. Override mechanism works and logs correctly
6. No significant latency increase (< 2s added per generation)
