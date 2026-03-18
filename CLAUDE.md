# Micode: Project Rules

## Writing

- Never use em dashes. Use colons, commas, or parentheses for asides, and restructure sentences that rely on em dashes.

## Code Style

- No classes for business logic. Use factory functions (`createX`) with closed-over state
- No nesting beyond 2 levels inside a function body. Prefer early returns and small helpers
- Max function length: 40 lines (skipBlankLines, skipComments)
- No magic numbers/strings. Use named constants. Place shared tunables in `src/utils/config.ts`
- No `any` types. Minimize type assertions (`as Type`): prefer Valibot schemas or type guards to narrow. Assertions are acceptable when the plugin SDK's loose typing leaves no alternative
- Use `unknown` at system boundaries and normalize with Valibot or `extractErrorMessage(...)` before handling
- No comments explaining *what*, only *why* when non-obvious
- Double quotes, semicolons, trailing commas (enforced by Biome)

## Architecture

- Agents are configuration objects, not implementations: pure data in `src/agents/`
- Hooks are factory functions returning lifecycle handler objects in `src/hooks/`
- Tools are Bun tool definitions created via the plugin's `tool()` function in `src/tools/`
- Shared utilities live in `src/utils/`; centralized config in `src/utils/config.ts`
- Use named exports only; do not add default exports in `src` (config files excepted)
- Re-export public APIs through barrel files (`index.ts`)

## TypeScript

- Names are contracts: domain-meaningful, no `data`/`result`/`temp`
- Prefer single-word names. Drop redundant prefixes (`allWarnings` -> `warnings`, `currentFiles` -> `files`). Context (scope, parameter position, containing object) should carry the qualifier, not the name
- No type names in identifiers (no Hungarian notation): avoid suffixes like `Map`, `Array`, `List`, `String`, `Object`, `Set`, `Dict`, `Number`, `Boolean`, `Fn`, `Func`, `Callback`. Name by what it holds in the domain, not its data structure
- Prefer `interface` for contracts and `type` for unions/aliases
- Discriminated unions over class hierarchies
- Use `as const` constant maps for statuses/events and derive union types from them
- Use `import type` for type-only imports
- Explicit return types on exported functions
- `readonly` on data structures that shouldn't mutate

## Module Structure

- Order files as: imports -> exported types/constants -> internal constants/schemas -> private helpers -> main factory/export
- Keep comments sparse and only for non-obvious behavior

## Imports and Paths

- Use `@/*` aliases for cross-folder project imports
- Use `./` relative imports within the same folder
- No parent-relative imports (`../`) where `@/*` is appropriate
- Use `node:` prefix for Node.js built-ins (`node:fs`, `node:path`)

## Engineering Principles

- DRY: extract shared patterns, no copy-paste
- YAGNI: no speculative features or unused abstractions
- Fail fast: validate inputs early, return/throw before the happy path
- Dependency injection: pass dependencies in, don't import singletons
- Errors are values: use `extractErrorMessage`/`formatToolError` from `src/utils/errors.ts`, no bare `catch {}`
- Graceful degradation: use `catchAndLog`/`catchAndLogAsync` for non-critical operations

## Validation

- Use Valibot (`v.*`) for schema definition and runtime validation
- Derive types from schemas via `v.InferOutput<typeof Schema>`
- Use pipe-based validation chains (`v.pipe(v.number(), v.minValue(1))`)
- Treat parse failures as non-fatal where possible: accumulate warnings and continue

## Event and Runtime Safety

- Never let listener exceptions break loops; wrap fan-out callbacks in `try/catch`
- Make cleanup best-effort (`disconnect/close/unsubscribe` should not mask primary failures)
- Define status names as `as const` maps with derived union types (see PTY, octto, and mindmodel modules for existing patterns)

## Testing

- Test real behavior, not mocked behavior. If a mock is the only thing being verified, the test is wrong
- Mock data, not behavior. Inject test data, don't spy on implementation details
- All error paths must have tests
- All public exports must have tests
- Test output must be pristine. Capture and validate expected errors
- Place tests in `tests/` mirroring the `src/` structure, with behavior-focused `it(...)` names
- Use Bun's native test runner (`bun:test`): `describe`, `it`, `expect`, `beforeEach`, `afterEach`
- Use `/tmp` unique paths for filesystem tests and always cleanup in `afterEach`
- Prefer condition polling helpers (`waitUntil` style) over fixed sleeps

## Tooling

- `bun run check` runs the full quality gate: `biome check . && eslint . && bun run typecheck && bun test`
- Pre-commit hook (lefthook) runs Biome check + ESLint fix on staged files
- CI runs full `bun run check` on every PR
- Run `bun run check` after substantive changes. If build/runtime-sensitive code changed, also run `bun run build`
