# Quality Gate Setup Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replicate agentprobe's full quality gate in micode: dual-layer linting (Biome + ESLint), structural code limits, type-safe CI/CD pipeline, and GitHub project infrastructure.

**Architecture:** Biome handles formatting and import rules. ESLint handles type-aware linting (typescript-eslint), structural limits (max-depth, max-lines), complexity analysis (sonarjs), and pattern enforcement (unicorn). Both run in pre-commit hooks, CI quality gate, and release pipeline. Rules that already pass the codebase are set to `error`; rules with existing violations start at `warn` and get promoted in follow-up PRs.

**Tech Stack:** Biome 2.x, ESLint 10.x, typescript-eslint 8.x, eslint-plugin-sonarjs, eslint-plugin-unicorn, lefthook, GitHub Actions, Bun runtime.

**Branch:** `feat/quality-gate`

---

## Decision Log

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Line width | Keep 120 | Minimize churn; micode already uses 120 consistently |
| Pre-commit tool | Keep lefthook | Already installed; add ESLint step alongside biome |
| Test runner | Keep bun:test | Native bun runtime; 58 test files already use it |
| CI runtime | Bun (not Node matrix) | micode targets bun specifically (`--target bun`) |
| Type assertions rule | OFF initially | 119 violations; separate refactoring PR needed |
| Import aliases (`@/*`) | Defer to follow-up PR | 56 files to touch; separate focused PR |
| Function decomposition | Defer to follow-up PR | ~45 functions exceed limit; significant refactoring |

---

## Violation Inventory (from audit)

Rules that will be **ERROR** (0 violations or fixed in this PR):

| Rule | Violations | Action |
|------|-----------|--------|
| `no-explicit-any` | 2 | Fix in Task 10 |
| `noDefaultExport` (biome) | 1 | Fix in Task 11 |
| `noNonNullAssertion` (biome) | 3 | Fix in Task 12 |
| `explicit-function-return-type` | 0 | Enable as error |
| `consistent-type-imports` | 10 mixed | Auto-fix with `eslint --fix` |
| `consistent-type-definitions` | 0 | Enable as error |
| `no-floating-promises` | 0 | Enable as error |
| `no-misused-promises` | 0 | Enable as error |
| `no-identical-functions` | 0 | Enable as error |
| `no-nested-ternary` | 0 | Enable as error |

Rules that will be **WARN** (existing violations, promote to error in follow-up):

| Rule | Violations | Follow-up effort |
|------|-----------|-----------------|
| `max-depth: 2` | ~8 files | Medium |
| `max-lines-per-function: 40` | ~45 files | Large |
| `naming-convention` (Hungarian filter) | 19 identifiers | Small-Medium |
| `no-magic-numbers` | ~40 instances | Medium |
| `prefer-readonly` | Unknown | Small |
| `cognitive-complexity: 10` | 4 functions | Small |
| `no-duplicate-string: 3` | ~3 patterns | Small |
| `use-unknown-in-catch-callback-variable` | Unknown | Medium |

Rules that will be **OFF** (massive effort, separate PR required):

| Rule | Violations | Estimated effort |
|------|-----------|-----------------|
| `consistent-type-assertions: never` | 119 assertions | Large (needs Zod/type guards) |
| `noRestrictedImports` for `../` (biome) | 56 imports | Medium (needs `@/*` alias setup) |

---

## Phase 1: Tooling Foundation

### Task 1: Install ESLint and plugins

**Files:**
- Modify: `/Users/whitemonk/projects/config/micode/package.json`

**Step 1: Install ESLint devDependencies**

Run:
```bash
cd /Users/whitemonk/projects/config/micode
bun add -d eslint@^10.0.3 @eslint/js@^10.0.1 typescript-eslint@^8.57.0 eslint-plugin-sonarjs@^4.0.2 eslint-plugin-unicorn@^63.0.0 lint-staged@^16.3.3
```

Expected: packages install successfully, `package.json` devDependencies updated.

**Step 2: Verify installation**

Run:
```bash
cd /Users/whitemonk/projects/config/micode
bunx eslint --version
```

Expected: Prints ESLint version (10.x).

---

### Task 2: Create ESLint configuration

**Files:**
- Create: `/Users/whitemonk/projects/config/micode/eslint.config.js`

**Step 1: Create the ESLint config file**

Write `eslint.config.js` with the following content:

```js
import js from "@eslint/js";
import sonarjs from "eslint-plugin-sonarjs";
import unicorn from "eslint-plugin-unicorn";
import tseslint from "typescript-eslint";

export default [
  {
    ignores: [
      "dist/**",
      "coverage/**",
      "node_modules/**",
      "examples/**",
      ".worktrees/**",
      ".mindmodel/**",
      ".opencode/**",
      "*.config.ts",
      "*.config.js",
      "thoughts/**",
      "docs/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      sonarjs,
      unicorn,
    },
    rules: {
      // --- Disable rules that overlap with Biome ---
      indent: "off",
      quotes: "off",
      semi: "off",
      "comma-dangle": "off",
      "no-unused-vars": "off",
      "sort-imports": "off",
      "no-multiple-empty-lines": "off",
      "eol-last": "off",

      // --- Structural limits ---
      // WARN: ~8 files violate max-depth, ~45 files violate max-lines
      "max-depth": ["warn", 2],
      "max-lines-per-function": ["warn", { max: 40, skipBlankLines: true, skipComments: true }],

      // --- TypeScript-specific ---
      "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports" }],
      "@typescript-eslint/consistent-type-definitions": ["error", "interface"],
      // WARN: unknown violation count
      "@typescript-eslint/prefer-readonly": "warn",
      // WARN: unknown violation count
      "@typescript-eslint/use-unknown-in-catch-callback-variable": "warn",
      "@typescript-eslint/explicit-function-return-type": [
        "error",
        {
          allowExpressions: true,
          allowTypedFunctionExpressions: true,
          allowHigherOrderFunctions: true,
        },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      // WARN: 19 naming violations (Hungarian notation suffixes, snake_case in interfaces)
      "@typescript-eslint/naming-convention": [
        "warn",
        { selector: "default", format: ["camelCase"], leadingUnderscore: "allow" },
        {
          selector: "variable",
          format: ["camelCase", "UPPER_CASE"],
          leadingUnderscore: "allow",
          filter: {
            regex: "(Map|Object|String|Array|List|Set|Dict|Number|Boolean|Fn|Func|Callback)$",
            match: false,
          },
        },
        {
          selector: "function",
          format: ["camelCase"],
          filter: {
            regex: "(Map|Object|String|Array|List|Set|Dict|Number|Boolean|Fn|Func|Callback)$",
            match: false,
          },
        },
        {
          selector: "parameter",
          format: ["camelCase"],
          leadingUnderscore: "allow",
          filter: {
            regex: "(Map|Object|String|Array|List|Set|Dict|Number|Boolean|Fn|Func|Callback)$",
            match: false,
          },
        },
        { selector: "typeLike", format: ["PascalCase"] },
        {
          selector: "objectLiteralProperty",
          format: null,
          filter: { regex: "^[a-z]+(_[a-z]+)+$", match: true },
        },
      ],
      // WARN: ~40 magic number violations
      "@typescript-eslint/no-magic-numbers": [
        "warn",
        {
          ignore: [0, 1, -1, 2],
          ignoreEnums: true,
          ignoreNumericLiteralTypes: true,
          ignoreReadonlyClassProperties: true,
        },
      ],
      "@typescript-eslint/no-explicit-any": "error",
      // OFF: 119 type assertions need Zod/type-guard refactoring (separate PR)
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",

      // --- Sonarjs (complexity and duplication) ---
      // WARN: 4 functions exceed cognitive complexity 10
      "sonarjs/cognitive-complexity": ["warn", 10],
      // WARN: several duplicate string patterns
      "sonarjs/no-duplicate-string": ["warn", { threshold: 3 }],
      "sonarjs/no-identical-functions": "error",

      // --- Unicorn (patterns) ---
      "unicorn/no-nested-ternary": "error",
    },
  },
  {
    // Relax rules for test files
    files: ["tests/**/*.ts", "src/**/*.test.ts", "**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-magic-numbers": "off",
      "@typescript-eslint/explicit-function-return-type": "off",
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/naming-convention": "off",
      "@typescript-eslint/consistent-type-definitions": "off",
      "@typescript-eslint/prefer-readonly": "off",
      "@typescript-eslint/use-unknown-in-catch-callback-variable": "off",
      "sonarjs/no-duplicate-string": "off",
      "sonarjs/cognitive-complexity": "off",
      "max-depth": "off",
      "max-lines-per-function": "off",
    },
  },
];
```

**Step 2: Run ESLint to see current violations**

Run:
```bash
cd /Users/whitemonk/projects/config/micode
bunx eslint . 2>&1 | tail -20
```

Expected: Warnings for known violations, errors only for the few we'll fix in Tasks 10-12.

---

### Task 3: Create TypeScript config for ESLint

**Files:**
- Create: `/Users/whitemonk/projects/config/micode/tsconfig.eslint.json`

ESLint's type-aware rules need a tsconfig that covers both `src/` and `tests/`. The main `tsconfig.json` only includes `src/` (because `rootDir: "./src"` prevents including tests). This separate config extends the base and removes the rootDir constraint.

**Step 1: Create tsconfig.eslint.json**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "rootDir": ".",
    "noEmit": true
  },
  "include": ["src", "tests"]
}
```

**Step 2: Update eslint.config.js to use it**

In the `languageOptions.parserOptions` section of `eslint.config.js`, change:

```js
parserOptions: {
  projectService: true,
  tsconfigRootDir: import.meta.dirname,
},
```

to:

```js
parserOptions: {
  project: "./tsconfig.eslint.json",
  tsconfigRootDir: import.meta.dirname,
},
```

**Step 3: Verify ESLint can resolve types**

Run:
```bash
cd /Users/whitemonk/projects/config/micode
bunx eslint src/utils/logger.ts 2>&1 | head -10
```

Expected: Either no errors or only expected warnings (no "cannot find tsconfig" errors).

---

## Phase 2: Biome Hardening

### Task 4: Update Biome configuration

**Files:**
- Modify: `/Users/whitemonk/projects/config/micode/biome.json`

**Step 1: Replace biome.json with hardened config**

Replace the entire contents of `biome.json` with:

```json
{
  "$schema": "https://biomejs.dev/schemas/2.4.7/schema.json",
  "vcs": {
    "enabled": true,
    "clientKind": "git",
    "useIgnoreFile": true
  },
  "files": {
    "ignoreUnknown": false
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 120
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "correctness": {
        "noUnusedVariables": "off"
      },
      "suspicious": {
        "noControlCharactersInRegex": "off"
      },
      "style": {
        "noParameterAssign": "error",
        "noDefaultExport": "error"
      }
    }
  },
  "javascript": {
    "formatter": {
      "quoteStyle": "double",
      "semicolons": "always",
      "trailingCommas": "all",
      "bracketSpacing": true,
      "arrowParentheses": "always"
    }
  },
  "overrides": [
    {
      "includes": ["*.config.ts", "*.config.js"],
      "linter": {
        "rules": {
          "style": {
            "noDefaultExport": "off"
          }
        }
      }
    }
  ],
  "assist": {
    "enabled": true,
    "actions": {
      "source": {
        "organizeImports": "on"
      }
    }
  }
}
```

Key changes from current config:
- Removed `files.includes` (let biome auto-detect; was unnecessarily restrictive)
- Added `correctness.noUnusedVariables: "off"` (ESLint handles this with type-awareness)
- Removed `suspicious.noExplicitAny: "off"` (now enforced; only 2 violations to fix)
- Removed `suspicious.noExtraNonNullAssertion: "off"` (restore recommended default)
- Removed `style.noNonNullAssertion: "off"` (restore recommended default; 3 violations to fix)
- Added `style.noParameterAssign: "error"`
- Added `style.noDefaultExport: "error"` (with config file override)
- Added `semicolons: "always"`, `trailingCommas: "all"`, `bracketSpacing: true`, `arrowParentheses: "always"`
- Kept `lineWidth: 120` (micode convention)
- Kept `noControlCharactersInRegex: "off"` (intentional regex patterns)
- Simplified import organization (removed bun-specific groups that may not be supported in 2.4.7)

**Step 2: Run biome format to auto-fix formatting changes**

The semicolons/trailing commas changes will require reformatting:

Run:
```bash
cd /Users/whitemonk/projects/config/micode
bunx biome check --write .
```

Expected: Many files reformatted with semicolons and trailing commas added. Review the output to confirm only formatting changes (no logic changes).

**Step 3: Verify biome passes**

Run:
```bash
cd /Users/whitemonk/projects/config/micode
bunx biome check . 2>&1 | tail -20
```

Expected: Errors only for `noDefaultExport` (1 instance in `src/index.ts`) and `noNonNullAssertion` (3 instances). These are fixed in Tasks 11-12.

**Step 4: Commit formatting changes**

Run:
```bash
cd /Users/whitemonk/projects/config/micode
git add -A
git commit -m "style: apply biome formatting (semicolons, trailing commas, arrow parens)"
```

This commit is pure formatting. Separating it makes review of subsequent changes cleaner.

---

## Phase 3: Scripts & Hooks

### Task 5: Update package.json scripts

**Files:**
- Modify: `/Users/whitemonk/projects/config/micode/package.json`

**Step 1: Update scripts section**

Replace the `scripts` section with:

```json
"scripts": {
  "prepare": "lefthook install",
  "build": "bun build src/index.ts --outdir dist --target bun --external bun-pty",
  "typecheck": "tsc --noEmit",
  "prepublishOnly": "bun run check && bun run build",
  "test": "bun test",
  "test:watch": "bun test --watch",
  "format": "biome format --write .",
  "lint": "biome lint . && eslint .",
  "lint:biome": "biome lint .",
  "lint:eslint": "eslint .",
  "check": "biome check . && eslint . && bun run typecheck && bun test",
  "clean": "rm -rf dist coverage"
}
```

Changes from current:
- `check` now runs full pipeline: biome + eslint + typecheck + test
- `lint` now includes eslint
- Added `lint:biome` and `lint:eslint` for running individually
- `prepublishOnly` now runs full check + build (was only typecheck)
- Added `clean` script

**Step 2: Verify check script structure**

Run:
```bash
cd /Users/whitemonk/projects/config/micode
cat package.json | grep -A 15 '"scripts"'
```

Expected: Updated scripts visible.

---

### Task 6: Update lefthook pre-commit hooks

**Files:**
- Modify: `/Users/whitemonk/projects/config/micode/lefthook.yml`

**Step 1: Update lefthook.yml**

Replace the entire contents with:

```yaml
pre-commit:
  commands:
    biome:
      glob: "**/*.{ts,tsx,js,jsx,json}"
      run: bunx biome check --write --staged {staged_files}
      stage_fixed: true
    eslint:
      glob: "**/*.{ts,tsx}"
      run: bunx eslint --fix {staged_files}
      stage_fixed: true
```

Changes: Added `eslint` command that runs `eslint --fix` on staged TypeScript files.

**Step 2: Verify lefthook config is valid**

Run:
```bash
cd /Users/whitemonk/projects/config/micode
bunx lefthook run pre-commit --dry-run 2>&1 || true
```

Expected: Shows both `biome` and `eslint` commands would execute.

---

## Phase 4: CI/CD Pipeline

### Task 7: Create quality gate workflow

**Files:**
- Replace: `/Users/whitemonk/projects/config/micode/.github/workflows/ci.yml` with `/Users/whitemonk/projects/config/micode/.github/workflows/quality-gate.yml`

**Step 1: Delete old CI workflow**

Run:
```bash
rm /Users/whitemonk/projects/config/micode/.github/workflows/ci.yml
```

**Step 2: Create quality-gate.yml**

Write `.github/workflows/quality-gate.yml`:

```yaml
name: Quality Gate

on:
  push:
    branches: [main]
  pull_request:

jobs:
  check:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest

      - name: Install dependencies
        run: bun install --frozen-lockfile

      - name: Quality gate
        run: bun run check

      - name: Build
        run: bun run build
```

Changes from old `ci.yml`:
- Renamed from "CI" to "Quality Gate"
- `bun install --frozen-lockfile` instead of `bun install` (deterministic)
- `bun run check` replaces separate typecheck + test steps (now includes biome + eslint + typecheck + test)
- Added build step
- Runs on all PRs (not just PRs targeting main)

---

### Task 8: Update release workflow

**Files:**
- Modify: `/Users/whitemonk/projects/config/micode/.github/workflows/release.yml`

**Step 1: Add quality gate to release**

Replace the entire contents with:

```yaml
name: Release

on:
  push:
    tags:
      - "v*"
  workflow_dispatch:

jobs:
  publish:
    runs-on: ubuntu-latest

    permissions:
      contents: read
      id-token: write

    steps:
      - uses: actions/checkout@v4

      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest

      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          registry-url: "https://registry.npmjs.org"

      - name: Update npm
        run: npm install -g npm@latest

      - name: Install dependencies
        run: bun install --frozen-lockfile

      - name: Verify quality gates
        run: bun run check

      - name: Build
        run: bun run build

      - name: Publish to npm
        run: npm publish --provenance --access public
```

Changes:
- Added `bun install --frozen-lockfile`
- Added `Verify quality gates` step before build/publish
- Kept npm for publish (required for `--provenance` and registry auth)

---

### Task 9: Add Dependabot configuration

**Files:**
- Create: `/Users/whitemonk/projects/config/micode/.github/dependabot.yml`

**Step 1: Create dependabot.yml**

```yaml
version: 2

updates:
  - package-ecosystem: npm
    directory: /
    schedule:
      interval: weekly
    open-pull-requests-limit: 10

  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: weekly
    open-pull-requests-limit: 5
```

---

## Phase 5: GitHub Templates

### Task 10: Add GitHub issue and PR templates

**Files:**
- Create: `/Users/whitemonk/projects/config/micode/.github/PULL_REQUEST_TEMPLATE.md`
- Create: `/Users/whitemonk/projects/config/micode/.github/ISSUE_TEMPLATE/bug_report.md`
- Create: `/Users/whitemonk/projects/config/micode/.github/ISSUE_TEMPLATE/feature_request.md`

**Step 1: Create PR template**

Write `.github/PULL_REQUEST_TEMPLATE.md`:

```markdown
## What

Brief description of the change.

## Why

What problem does this solve? Link to related issue if applicable.

## Checklist

- [ ] Tests added or updated
- [ ] `bun run check` passes
- [ ] Documentation updated (if public API changed)
- [ ] CHANGELOG.md updated (if user-facing change)
```

**Step 2: Create issue templates directory and bug report**

Run:
```bash
mkdir -p /Users/whitemonk/projects/config/micode/.github/ISSUE_TEMPLATE
```

Write `.github/ISSUE_TEMPLATE/bug_report.md`:

```markdown
---
name: Bug Report
about: Report a bug to help us improve
title: ""
labels: bug
assignees: ""
---

## Description

A clear and concise description of the bug.

## Steps to Reproduce

1. ...
2. ...
3. ...

## Expected Behavior

What you expected to happen.

## Actual Behavior

What actually happened. Include error messages or stack traces if applicable.

## Environment

- **Bun version**:
- **Package version**:
- **OS**:

## Additional Context

Any other context, screenshots, or logs.
```

**Step 3: Create feature request template**

Write `.github/ISSUE_TEMPLATE/feature_request.md`:

```markdown
---
name: Feature Request
about: Suggest a new feature or improvement
title: ""
labels: enhancement
assignees: ""
---

## Problem

What problem does this feature solve? What's the use case?

## Proposed Solution

Describe the solution you'd like.

## Alternatives Considered

Any alternative approaches you've considered.

## Additional Context

Any other context, examples, or references.
```

---

## Phase 6: Quick Code Fixes

These fix the few violations that are set to `error` level, so the quality gate passes.

### Task 11: Fix explicit `any` usage (2 violations)

**Files:**
- Modify: `/Users/whitemonk/projects/config/micode/src/tools/octto/types.ts:10-11`

**Step 1: Read the file to understand context**

Run:
```bash
cd /Users/whitemonk/projects/config/micode
head -20 src/tools/octto/types.ts
```

**Step 2: Replace `any` with `unknown`**

In `src/tools/octto/types.ts`, change:

```typescript
args: any;
execute: (args: any, context: ToolContext) => Promise<string>;
```

to:

```typescript
args: unknown;
execute: (args: unknown, context: ToolContext) => Promise<string>;
```

**Step 3: Verify no type errors cascade**

Run:
```bash
cd /Users/whitemonk/projects/config/micode
bun run typecheck 2>&1 | head -20
```

Expected: No new type errors. If there are errors, add type narrowing (Zod schema or type guard) at the call sites.

---

### Task 12: Fix default export (1 violation)

**Files:**
- Modify: `/Users/whitemonk/projects/config/micode/src/index.ts:488`

**Step 1: Read the end of index.ts**

Run:
```bash
cd /Users/whitemonk/projects/config/micode
tail -10 src/index.ts
```

**Step 2: Replace default export with named export**

Change:

```typescript
export default OpenCodeConfigPlugin;
```

to:

```typescript
export { OpenCodeConfigPlugin };
```

NOTE: Check if any file imports this as a default import (e.g., `import Plugin from "./index"`). If so, update those imports to use the named import. This is unlikely since the codebase convention is named exports.

**Step 3: Verify no import errors**

Run:
```bash
cd /Users/whitemonk/projects/config/micode
bun run typecheck 2>&1 | head -20
```

Expected: PASS. If any file uses default import of this module, update it.

---

### Task 13: Fix non-null assertions (3 violations)

**Files:**
- Modify: `/Users/whitemonk/projects/config/micode/src/mindmodel/types.ts:71`
- Modify: `/Users/whitemonk/projects/config/micode/src/hooks/constraint-reviewer.ts:42`
- Modify: `/Users/whitemonk/projects/config/micode/src/hooks/context-injector.ts:57`

**Step 1: Read each file around the violation lines**

Read the context around each violation to understand the pattern.

**Step 2: Fix mindmodel/types.ts:71**

Replace the `!` non-null assertion with a fallback or guard. The pattern is:

```typescript
nextSectionMatch.index!
```

Replace with:

```typescript
(nextSectionMatch.index ?? 0)
```

Or if the value is guaranteed non-null by the regex match, use an explicit check:

```typescript
const matchIndex = nextSectionMatch.index;
if (matchIndex === undefined) throw new Error("Regex match missing index");
// then use matchIndex
```

**Step 3: Fix hooks/constraint-reviewer.ts:42**

The pattern is `sessionState.get(sessionID)!`. Replace with:

```typescript
const state = sessionState.get(sessionID);
if (!state) return; // or throw, depending on context
```

**Step 4: Fix hooks/context-injector.ts:57**

The pattern is `cache.directoryContent.get(cacheKey)!`. Replace with:

```typescript
const cached = cache.directoryContent.get(cacheKey);
if (!cached) return; // or throw, depending on context
```

**Step 5: Verify typecheck passes**

Run:
```bash
cd /Users/whitemonk/projects/config/micode
bun run typecheck 2>&1 | head -20
```

Expected: PASS.

---

## Phase 7: Auto-fix, Verify, and Commit

### Task 14: Run ESLint auto-fix for type imports

**Step 1: Auto-fix consistent-type-imports**

Run:
```bash
cd /Users/whitemonk/projects/config/micode
bunx eslint --fix . 2>&1 | tail -20
```

This will auto-fix the 10 mixed `import`/`import type` statements and any other auto-fixable issues.

**Step 2: Run biome format to clean up any formatting inconsistencies**

Run:
```bash
cd /Users/whitemonk/projects/config/micode
bunx biome check --write .
```

**Step 3: Run the full quality gate**

Run:
```bash
cd /Users/whitemonk/projects/config/micode
bun run check
```

Expected: PASS (with warnings for the rules set to `warn`). If there are unexpected errors, investigate and fix them before proceeding.

**Step 4: Run tests to verify nothing is broken**

Run:
```bash
cd /Users/whitemonk/projects/config/micode
bun test
```

Expected: All 58 test files pass.

---

### Task 15: Commit all quality gate changes

**Step 1: Review changes**

Run:
```bash
cd /Users/whitemonk/projects/config/micode
git status
git diff --stat
```

Review the output. The changes should be:
- New files: `eslint.config.js`, `tsconfig.eslint.json`, `dependabot.yml`, PR/issue templates
- Modified files: `package.json`, `biome.json`, `lefthook.yml`, `release.yml`
- Replaced: `ci.yml` -> `quality-gate.yml`
- Modified source files: quick fixes in types.ts, index.ts, constraint-reviewer.ts, context-injector.ts, mindmodel/types.ts
- Reformatted files (from biome auto-fix)

**Step 2: Stage and commit**

Run:
```bash
cd /Users/whitemonk/projects/config/micode
git add eslint.config.js tsconfig.eslint.json .github/ lefthook.yml biome.json package.json bun.lock src/tools/octto/types.ts src/index.ts src/mindmodel/types.ts src/hooks/constraint-reviewer.ts src/hooks/context-injector.ts
git commit -m "feat: add full quality gate (biome + eslint + CI pipeline + GitHub templates)"
```

---

## Follow-up Work (Separate PRs)

The following violations are at `warn` level in ESLint. Each category should be promoted to `error` after fixing all violations in a dedicated PR.

### Follow-up 1: Import Migration to `@/*` Aliases

**Scope:** 56 parent-relative imports across 37 files.

**Steps:**
1. Add `@/*` path aliases to `tsconfig.json` and `tsconfig.eslint.json`
2. Configure bun to resolve aliases (may need `bunfig.toml` or build config update)
3. Add `noRestrictedImports` rule to `biome.json` for `../` pattern
4. Rewrite all 56 `../` imports to `@/` imports
5. Verify typecheck and tests pass
6. Commit

### Follow-up 2: Naming Convention Fixes

**Scope:** 19 violations.

| Identifier | File | Fix |
|-----------|------|-----|
| `providerMap` | config-loader.ts:344 | Rename to `providers` |
| `octtoSessionsMap` | index.ts:199 | Rename to `octtoSessions` |
| `ReviewFn` | hooks/constraint-reviewer.ts:15 | Rename to `ReviewFunction` or `Reviewer` |
| `SpawnFn` | tools/pty/manager.ts:7 | Rename to `SpawnFunction` or `Spawner` |
| `spawnFn` | tools/pty/manager.ts:18 | Rename to `spawner` |
| `formatFindingsList` | tools/octto/formatters.ts:35 | Rename to `formatFindings` |
| 13 snake_case properties | octto types | Rename to camelCase with API adapter layer |

After fixing: promote `@typescript-eslint/naming-convention` from `warn` to `error`.

### Follow-up 3: Magic Number Extraction

**Scope:** ~40 instances across ~15 files.

**Pattern:** Extract each magic number to a named constant at the top of its file or in a shared `constants.ts`.

Example:
```typescript
// Before
const cols = 120;
const rows = 40;

// After
const DEFAULT_TERMINAL_COLS = 120;
const DEFAULT_TERMINAL_ROWS = 40;
```

After fixing: promote `@typescript-eslint/no-magic-numbers` from `warn` to `error`.

### Follow-up 4: Cognitive Complexity Reduction

**Scope:** 4 functions.

| Function | File | Complexity |
|----------|------|-----------|
| `mergeAgentConfigs()` | config-loader.ts:272 | 3 nested conditionals + 2 loops |
| `validateAgentModels()` | config-loader.ts:333 | 4 nested conditionals + 2 loops |
| `getAnswer()` | octto/session/sessions.ts:165 | 5 early returns + nested Promise |
| `withSessionLock()` | octto/state/store.ts:33 | Queue-based sync |

After fixing: promote `sonarjs/cognitive-complexity` from `warn` to `error`.

### Follow-up 5: Duplicate String Extraction

**Scope:** 3 patterns.

| String | Occurrences | Fix |
|--------|------------|-----|
| `"Session not found: ${sessionId}"` | 8 | Extract `SESSION_NOT_FOUND` constant |
| `"Branch not found: ${branchId}"` | 3 | Extract `BRANCH_NOT_FOUND` constant |
| `"Database not initialized"` | 5 | Extract `ensureInitialized()` helper |

After fixing: promote `sonarjs/no-duplicate-string` from `warn` to `error`.

### Follow-up 6: Function Decomposition

**Scope:** ~45 functions exceeding 40 lines. Largest effort.

Priority targets (files over 300 lines with long functions):
1. `octto/ui/bundle.ts` (1650 lines) - extract HTML/CSS/JS into template helpers
2. `tools/octto/questions.ts` (508 lines) - extract question definitions
3. `index.ts` (488 lines) - extract plugin setup phases
4. `tools/artifact-index/index.ts` (418 lines) - extract DB operations
5. `config-loader.ts` (395 lines) - extract validation logic

After fixing: promote `max-lines-per-function` from `warn` to `error`.

### Follow-up 7: Type Assertion Elimination

**Scope:** 119 type assertions across 12+ files. Largest effort.

**Approach:** Replace `as Type` assertions with:
- Zod schemas for JSON.parse results
- Discriminated union type guards for Answer types
- Generic wrappers for Map/Record access

Priority files:
1. `hooks/session-recovery.ts` (14 assertions)
2. `hooks/token-aware-truncation.ts` (13 assertions)
3. `tools/octto/extractor.ts` (12 assertions)
4. `hooks/auto-compact.ts` (12 assertions)
5. `hooks/fetch-tracker.ts` (11 assertions)
6. `config-loader.ts` (11 assertions)

After fixing: promote `@typescript-eslint/consistent-type-assertions` from `off` to `["error", { assertionStyle: "never" }]`.

### Follow-up 8: Silent Error Handler Audit

**Scope:** 9 `.catch(() => {})` patterns.

Replace each with at minimum `log.warn()` or document why suppression is safe:

| File | Count |
|------|-------|
| `hooks/auto-compact.ts` | 4 |
| `hooks/session-recovery.ts` | 3 |
| `hooks/context-window-monitor.ts` | 1 |
| `tools/spawn-agent.ts` | 1 |

### Follow-up 9: Nesting Depth Reduction

**Scope:** ~8 files with nesting > 2 levels.

**Approach:** Extract nested blocks into helper functions, use early returns.

After fixing: promote `max-depth` from `warn` to `error`.

### Follow-up 10: Miscellaneous

- Move `src/config-loader.test.ts` to `tests/config-loader-unit.test.ts`
- Add coverage thresholds to test config
- Add `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `CHANGELOG.md`
- Fix `types` field in `package.json` (should point to `dist/index.d.ts` not `src/index.ts`)
