# mindmodel v2 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement constraint-guided generation with enforcement - deep codebase analysis, post-generation review, automatic retry, and override mechanism.

**Architecture:** Extend existing mindmodel infrastructure with 7 new agents, enhanced manifest schema, constraint reviewer hook, and enforcement flow.

**Tech Stack:** TypeScript, valibot for schemas, micode plugin hooks, subagent orchestration

---

## Phase 1: Schema and Types Updates

### Task 1: Update Manifest Schema for v2 Structure

**Files:**
- Modify: `src/mindmodel/types.ts`
- Test: `tests/mindmodel/types.test.ts`

**Step 1: Write failing test for new schema**

```typescript
// tests/mindmodel/types.test.ts - add these tests

describe("ManifestSchemaV2", () => {
  it("should parse manifest with nested category structure", () => {
    const yaml = `
name: test-project
version: 2
categories:
  - path: stack/frontend.md
    description: Frontend tech stack
    group: stack
  - path: patterns/error-handling.md
    description: Error handling patterns
    group: patterns
`;
    const result = parseManifest(yaml);
    expect(result.version).toBe(2);
    expect(result.categories[0].group).toBe("stack");
  });

  it("should support optional group field for backwards compatibility", () => {
    const yaml = `
name: test-project
version: 1
categories:
  - path: components/form.md
    description: Form patterns
`;
    const result = parseManifest(yaml);
    expect(result.categories[0].group).toBeUndefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/whitemonk/projects/config/micode && npm test -- tests/mindmodel/types.test.ts`
Expected: FAIL - group property not in schema

**Step 3: Update schema**

```typescript
// src/mindmodel/types.ts
import * as v from "valibot";
import { parse as parseYaml } from "yaml";

export const CategorySchema = v.object({
  path: v.string(),
  description: v.string(),
  group: v.optional(v.string()),
});

export const ManifestSchema = v.object({
  name: v.string(),
  version: v.pipe(v.number(), v.minValue(1)),
  categories: v.pipe(v.array(CategorySchema), v.minLength(1)),
});

export type Category = v.InferOutput<typeof CategorySchema>;
export type MindmodelManifest = v.InferOutput<typeof ManifestSchema>;

export function parseManifest(yamlContent: string): MindmodelManifest {
  const parsed = parseYaml(yamlContent);
  return v.parse(ManifestSchema, parsed);
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/whitemonk/projects/config/micode && npm test -- tests/mindmodel/types.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/mindmodel/types.ts tests/mindmodel/types.test.ts
git commit -m "feat(mindmodel): add group field to category schema for v2 structure"
```

---

### Task 2: Add Constraint File Schema

**Files:**
- Modify: `src/mindmodel/types.ts`
- Test: `tests/mindmodel/types.test.ts`

**Step 1: Write failing test for constraint file parsing**

```typescript
// tests/mindmodel/types.test.ts - add these tests

describe("ConstraintFileSchema", () => {
  it("should parse constraint file with rules, examples, and anti-patterns", () => {
    const content = `# Error Handling

## Rules
- Always wrap errors with context
- Never swallow errors silently

## Examples

### Wrapping errors
\`\`\`go
if err != nil {
    return fmt.Errorf("failed: %w", err)
}
\`\`\`

## Anti-patterns

### Swallowing errors
\`\`\`go
if err != nil {
    return nil // BAD
}
\`\`\`
`;
    const result = parseConstraintFile(content);
    expect(result.title).toBe("Error Handling");
    expect(result.rules).toHaveLength(2);
    expect(result.examples).toHaveLength(1);
    expect(result.antiPatterns).toHaveLength(1);
  });

  it("should handle constraint file with only rules", () => {
    const content = `# Naming

## Rules
- Use camelCase for functions
- Use PascalCase for types
`;
    const result = parseConstraintFile(content);
    expect(result.title).toBe("Naming");
    expect(result.rules).toHaveLength(2);
    expect(result.examples).toHaveLength(0);
    expect(result.antiPatterns).toHaveLength(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/whitemonk/projects/config/micode && npm test -- tests/mindmodel/types.test.ts`
Expected: FAIL - parseConstraintFile not defined

**Step 3: Implement constraint file parser**

```typescript
// src/mindmodel/types.ts - add to existing file

export interface ConstraintExample {
  title: string;
  code: string;
  language: string;
}

export interface ConstraintFile {
  title: string;
  rules: string[];
  examples: ConstraintExample[];
  antiPatterns: ConstraintExample[];
}

export function parseConstraintFile(content: string): ConstraintFile {
  const lines = content.split("\n");

  // Extract title from first H1
  const titleMatch = content.match(/^#\s+(.+)$/m);
  const title = titleMatch ? titleMatch[1] : "Untitled";

  // Extract rules
  const rulesSection = content.match(/## Rules\n([\s\S]*?)(?=\n##|$)/);
  const rules: string[] = [];
  if (rulesSection) {
    const ruleLines = rulesSection[1].match(/^-\s+(.+)$/gm);
    if (ruleLines) {
      rules.push(...ruleLines.map(r => r.replace(/^-\s+/, "")));
    }
  }

  // Extract examples
  const examples = extractCodeBlocks(content, "## Examples");

  // Extract anti-patterns
  const antiPatterns = extractCodeBlocks(content, "## Anti-patterns");

  return { title, rules, examples, antiPatterns };
}

function extractCodeBlocks(content: string, sectionHeader: string): ConstraintExample[] {
  const results: ConstraintExample[] = [];

  // Find section
  const sectionIndex = content.indexOf(sectionHeader);
  if (sectionIndex === -1) return results;

  // Find next section or end
  const nextSectionMatch = content.slice(sectionIndex + sectionHeader.length).match(/\n## /);
  const sectionEnd = nextSectionMatch
    ? sectionIndex + sectionHeader.length + nextSectionMatch.index!
    : content.length;

  const section = content.slice(sectionIndex, sectionEnd);

  // Extract H3 titles and code blocks
  const blockRegex = /### (.+)\n```(\w+)?\n([\s\S]*?)```/g;
  let match;
  while ((match = blockRegex.exec(section)) !== null) {
    results.push({
      title: match[1],
      language: match[2] || "",
      code: match[3].trim(),
    });
  }

  return results;
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/whitemonk/projects/config/micode && npm test -- tests/mindmodel/types.test.ts`
Expected: PASS

**Step 5: Update exports in index**

```typescript
// src/mindmodel/index.ts - add export
export { parseConstraintFile, type ConstraintFile, type ConstraintExample } from "./types";
```

**Step 6: Commit**

```bash
git add src/mindmodel/types.ts src/mindmodel/index.ts tests/mindmodel/types.test.ts
git commit -m "feat(mindmodel): add constraint file parser for rules/examples/anti-patterns"
```

---

### Task 3: Add Config Values for v2

**Files:**
- Modify: `src/utils/config.ts`

**Step 1: Add mindmodel v2 config**

```typescript
// src/utils/config.ts - add to existing config object

  /**
   * Mindmodel v2 settings
   */
  mindmodel: {
    /** Override log file within .mindmodel/ */
    overrideLogFile: "overrides.log",
    /** Maximum automatic retries on constraint violation */
    reviewMaxRetries: 1,
    /** Enable/disable constraint review */
    reviewEnabled: true,
    /** Category groups for v2 structure */
    categoryGroups: [
      "stack",
      "architecture",
      "patterns",
      "style",
      "components",
      "domain",
      "ops",
    ] as readonly string[],
  },
```

**Step 2: Commit**

```bash
git add src/utils/config.ts
git commit -m "feat(mindmodel): add v2 config values for review and override"
```

---

## Phase 2: New Analysis Agents

### Task 4: Dependency Mapper Agent

**Files:**
- Create: `src/agents/mindmodel/dependency-mapper.ts`
- Test: `tests/agents/mindmodel/dependency-mapper.test.ts`

**Step 1: Write test**

```typescript
// tests/agents/mindmodel/dependency-mapper.test.ts
import { describe, expect, it } from "bun:test";
import { dependencyMapperAgent } from "../../../src/agents/mindmodel/dependency-mapper";

describe("dependency-mapper agent", () => {
  it("should be a subagent", () => {
    expect(dependencyMapperAgent.mode).toBe("subagent");
  });

  it("should have read-only tool access", () => {
    expect(dependencyMapperAgent.tools?.write).toBe(false);
    expect(dependencyMapperAgent.tools?.edit).toBe(false);
    expect(dependencyMapperAgent.tools?.bash).toBe(false);
  });

  it("should have prompt that analyzes imports", () => {
    expect(dependencyMapperAgent.prompt).toContain("import");
    expect(dependencyMapperAgent.prompt).toContain("dependencies");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/whitemonk/projects/config/micode && npm test -- tests/agents/mindmodel/dependency-mapper.test.ts`
Expected: FAIL - module not found

**Step 3: Implement agent**

```typescript
// src/agents/mindmodel/dependency-mapper.ts
import type { AgentConfig } from "@opencode-ai/sdk";

const PROMPT = `<environment>
You are running as part of the "micode" OpenCode plugin.
You are a SUBAGENT for mindmodel generation - mapping dependencies across the codebase.
</environment>

<purpose>
Analyze imports across the codebase to identify:
1. Approved/standard libraries (used widely)
2. One-off dependencies (used in 1-2 files)
3. Internal modules and their usage patterns
4. Forbidden or deprecated imports (if any patterns suggest this)
</purpose>

<process>
1. Glob for source files: **/*.{ts,tsx,js,jsx,py,go,rs}
2. Sample 20-30 files across different directories
3. Extract import statements from each
4. Categorize dependencies:
   - External packages (from node_modules, pip, etc.)
   - Internal modules (relative imports)
   - Built-in/standard library
5. Count usage frequency
6. Identify patterns:
   - "Always use X instead of Y"
   - "Import from barrel file, not direct path"
   - "Prefer internal wrapper over raw library"
</process>

<output-format>
## Dependency Analysis

### External Dependencies (Approved)
| Package | Usage Count | Purpose |
|---------|-------------|---------|
| react | 45 files | UI framework |
| zod | 23 files | Schema validation |

### Internal Modules
| Module | Usage Count | Purpose |
|--------|-------------|---------|
| @/lib/api | 18 files | API client wrapper |
| @/components/ui | 32 files | Shared UI components |

### One-off Dependencies (Review Needed)
- axios (1 file) - consider using internal fetch wrapper
- lodash (2 files) - consider native alternatives

### Import Patterns
- Use barrel exports: import from "@/components" not "@/components/Button"
- Internal API client: use "@/lib/api" not raw fetch

### Forbidden/Deprecated
- moment.js → use date-fns instead
- request → use fetch or internal client
</output-format>

<rules>
- Sample diverse files, not just one directory
- Focus on patterns, not exhaustive listing
- Note any inconsistencies in import style
- Identify wrapper libraries vs raw usage
</rules>`;

export const dependencyMapperAgent: AgentConfig = {
  description: "Maps dependencies and identifies approved vs one-off libraries",
  mode: "subagent",
  temperature: 0.2,
  tools: {
    write: false,
    edit: false,
    bash: false,
    task: false,
  },
  prompt: PROMPT,
};
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/whitemonk/projects/config/micode && npm test -- tests/agents/mindmodel/dependency-mapper.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/agents/mindmodel/dependency-mapper.ts tests/agents/mindmodel/dependency-mapper.test.ts
git commit -m "feat(mindmodel): add dependency-mapper agent"
```

---

### Task 5: Convention Extractor Agent

**Files:**
- Create: `src/agents/mindmodel/convention-extractor.ts`
- Test: `tests/agents/mindmodel/convention-extractor.test.ts`

**Step 1: Write test**

```typescript
// tests/agents/mindmodel/convention-extractor.test.ts
import { describe, expect, it } from "bun:test";
import { conventionExtractorAgent } from "../../../src/agents/mindmodel/convention-extractor";

describe("convention-extractor agent", () => {
  it("should be a subagent", () => {
    expect(conventionExtractorAgent.mode).toBe("subagent");
  });

  it("should have read-only tool access", () => {
    expect(conventionExtractorAgent.tools?.write).toBe(false);
    expect(conventionExtractorAgent.tools?.edit).toBe(false);
    expect(conventionExtractorAgent.tools?.bash).toBe(false);
  });

  it("should have prompt that analyzes naming conventions", () => {
    expect(conventionExtractorAgent.prompt).toContain("naming");
    expect(conventionExtractorAgent.prompt).toContain("convention");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/whitemonk/projects/config/micode && npm test -- tests/agents/mindmodel/convention-extractor.test.ts`
Expected: FAIL - module not found

**Step 3: Implement agent**

```typescript
// src/agents/mindmodel/convention-extractor.ts
import type { AgentConfig } from "@opencode-ai/sdk";

const PROMPT = `<environment>
You are running as part of the "micode" OpenCode plugin.
You are a SUBAGENT for mindmodel generation - extracting code conventions.
</environment>

<purpose>
Analyze the codebase to identify coding conventions:
1. Naming patterns (files, functions, variables, types)
2. Import organization (ordering, grouping)
3. File structure (what goes where)
4. Type patterns (how types are defined and used)
5. Comment styles (when and how to comment)
</purpose>

<process>
1. Sample 30-40 source files across the codebase
2. Analyze naming patterns:
   - File naming: kebab-case, camelCase, PascalCase?
   - Function naming: verbs, prefixes like "get", "handle", "use"?
   - Variable naming: descriptive, abbreviated?
   - Type/interface naming: prefixes like "I", "T"?
3. Analyze import organization:
   - External vs internal grouping?
   - Alphabetical ordering?
   - Type imports separate?
4. Analyze file structure:
   - Exports at top or bottom?
   - Constants location?
   - Types inline or separate files?
5. Analyze type patterns:
   - Interface vs type alias preference?
   - Generics usage patterns?
   - Strict null checks?
</process>

<output-format>
## Coding Conventions

### File Naming
- Components: PascalCase.tsx (e.g., UserProfile.tsx)
- Utilities: kebab-case.ts (e.g., format-date.ts)
- Tests: [name].test.ts co-located with source

### Function Naming
- Event handlers: handle[Event] (e.g., handleClick)
- Hooks: use[Name] (e.g., useUser)
- Getters: get[Thing] (e.g., getUserById)
- Boolean returns: is/has/can prefix (e.g., isValid)

### Variable Naming
- Constants: SCREAMING_SNAKE_CASE
- Private: _prefixed or #private
- Booleans: is/has/can prefix

### Type Patterns
- Prefer 'type' over 'interface' for object shapes
- No "I" prefix on interfaces
- Props types: [Component]Props
- Generic constraints: T extends BaseType

### Import Organization
1. External packages (react, lodash)
2. Internal aliases (@/lib, @/components)
3. Relative imports (./utils)
4. Type imports last

### Comments
- JSDoc for public APIs
- Inline comments for "why", not "what"
- TODO format: // TODO(username): description
</output-format>

<rules>
- Identify the DOMINANT pattern, not exceptions
- Note any linter configs that enforce conventions
- Focus on patterns that affect code generation
</rules>`;

export const conventionExtractorAgent: AgentConfig = {
  description: "Analyzes naming, style, and code organization conventions",
  mode: "subagent",
  temperature: 0.2,
  tools: {
    write: false,
    edit: false,
    bash: false,
    task: false,
  },
  prompt: PROMPT,
};
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/whitemonk/projects/config/micode && npm test -- tests/agents/mindmodel/convention-extractor.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/agents/mindmodel/convention-extractor.ts tests/agents/mindmodel/convention-extractor.test.ts
git commit -m "feat(mindmodel): add convention-extractor agent"
```

---

### Task 6: Domain Extractor Agent

**Files:**
- Create: `src/agents/mindmodel/domain-extractor.ts`
- Test: `tests/agents/mindmodel/domain-extractor.test.ts`

**Step 1: Write test**

```typescript
// tests/agents/mindmodel/domain-extractor.test.ts
import { describe, expect, it } from "bun:test";
import { domainExtractorAgent } from "../../../src/agents/mindmodel/domain-extractor";

describe("domain-extractor agent", () => {
  it("should be a subagent", () => {
    expect(domainExtractorAgent.mode).toBe("subagent");
  });

  it("should have read-only tool access", () => {
    expect(domainExtractorAgent.tools?.write).toBe(false);
    expect(domainExtractorAgent.tools?.edit).toBe(false);
    expect(domainExtractorAgent.tools?.bash).toBe(false);
  });

  it("should have prompt that extracts business terminology", () => {
    expect(domainExtractorAgent.prompt).toContain("domain");
    expect(domainExtractorAgent.prompt).toContain("terminology");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/whitemonk/projects/config/micode && npm test -- tests/agents/mindmodel/domain-extractor.test.ts`
Expected: FAIL - module not found

**Step 3: Implement agent**

```typescript
// src/agents/mindmodel/domain-extractor.ts
import type { AgentConfig } from "@opencode-ai/sdk";

const PROMPT = `<environment>
You are running as part of the "micode" OpenCode plugin.
You are a SUBAGENT for mindmodel generation - extracting business domain terminology.
</environment>

<purpose>
Analyze the codebase to build a glossary of business domain concepts:
1. Core entities and their relationships
2. Business terminology and definitions
3. Domain-specific abbreviations
4. Key workflows and processes
</purpose>

<process>
1. Find type definitions: **/*.{ts,tsx} for interfaces/types
2. Read database schemas if present (prisma, drizzle, migrations)
3. Analyze variable names and comments for domain terms
4. Look for README, docs, or comments explaining concepts
5. Build a glossary with definitions
</process>

<output-format>
## Domain Glossary

### Core Entities
| Entity | Definition | Related Entities |
|--------|------------|------------------|
| User | A registered account | Profile, Session, Organization |
| Organization | A company or team | Users, Projects, Billing |
| Project | A workspace for tasks | Organization, Tasks, Members |

### Business Terms
| Term | Definition | Usage Context |
|------|------------|---------------|
| Workspace | Synonymous with Project in UI | User-facing |
| Tenant | Organization in multi-tenant context | Backend/DB |
| Seat | Licensed user slot | Billing |

### Abbreviations
| Abbrev | Full Term | Context |
|--------|-----------|---------|
| org | Organization | Code variables |
| tx | Transaction | Database operations |
| ctx | Context | Request/app context |

### Key Workflows
1. **User Onboarding**: Signup → Email verification → Profile creation → Team invite
2. **Billing Cycle**: Plan selection → Payment → Seat allocation → Renewal

### Invariants
- A User belongs to exactly one Organization
- Projects cannot exist without an Organization
- Deleted users are soft-deleted, not removed
</output-format>

<rules>
- Focus on domain concepts, not technical implementation
- Extract from types, schemas, and documentation
- Note any ambiguous or overloaded terms
- Include relationships between entities
</rules>`;

export const domainExtractorAgent: AgentConfig = {
  description: "Extracts business domain terminology and concepts",
  mode: "subagent",
  temperature: 0.2,
  tools: {
    write: false,
    edit: false,
    bash: false,
    task: false,
  },
  prompt: PROMPT,
};
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/whitemonk/projects/config/micode && npm test -- tests/agents/mindmodel/domain-extractor.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/agents/mindmodel/domain-extractor.ts tests/agents/mindmodel/domain-extractor.test.ts
git commit -m "feat(mindmodel): add domain-extractor agent"
```

---

### Task 7: Code Clusterer Agent

**Files:**
- Create: `src/agents/mindmodel/code-clusterer.ts`
- Test: `tests/agents/mindmodel/code-clusterer.test.ts`

**Step 1: Write test**

```typescript
// tests/agents/mindmodel/code-clusterer.test.ts
import { describe, expect, it } from "bun:test";
import { codeClustererAgent } from "../../../src/agents/mindmodel/code-clusterer";

describe("code-clusterer agent", () => {
  it("should be a subagent", () => {
    expect(codeClustererAgent.mode).toBe("subagent");
  });

  it("should have read-only tool access", () => {
    expect(codeClustererAgent.tools?.write).toBe(false);
    expect(codeClustererAgent.tools?.edit).toBe(false);
    expect(codeClustererAgent.tools?.bash).toBe(false);
  });

  it("should have prompt that groups similar code", () => {
    expect(codeClustererAgent.prompt).toContain("cluster");
    expect(codeClustererAgent.prompt).toContain("pattern");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/whitemonk/projects/config/micode && npm test -- tests/agents/mindmodel/code-clusterer.test.ts`
Expected: FAIL - module not found

**Step 3: Implement agent**

```typescript
// src/agents/mindmodel/code-clusterer.ts
import type { AgentConfig } from "@opencode-ai/sdk";

const PROMPT = `<environment>
You are running as part of the "micode" OpenCode plugin.
You are a SUBAGENT for mindmodel generation - clustering similar code patterns.
</environment>

<purpose>
Find and group similar code patterns across the codebase:
1. Error handling patterns
2. API call patterns
3. Data fetching/loading patterns
4. Validation patterns
5. Authentication/authorization checks
6. Logging patterns
7. State management patterns
</purpose>

<process>
1. Use ast-grep or grep to find pattern indicators:
   - Error handling: "catch", "try", "Error", "throw"
   - API calls: "fetch", "axios", "api.", "client."
   - Validation: "validate", "schema", "parse", "zod"
   - Auth: "auth", "session", "token", "permission"
   - Logging: "log.", "console.", "logger"
2. Sample 5-10 instances of each pattern type
3. Identify the COMMON approach (what 80%+ of code does)
4. Note variations and why they might exist
</process>

<output-format>
## Code Pattern Clusters

### Error Handling
**Dominant Pattern (found in 34/40 files):**
\`\`\`typescript
try {
  const result = await operation();
  return result;
} catch (error) {
  logger.error("Operation failed", { error, context });
  throw new AppError("OPERATION_FAILED", error);
}
\`\`\`

**Variations:**
- Some files use Result<T, E> pattern instead of try/catch
- API routes wrap in withErrorHandler HOF

### API Calls
**Dominant Pattern:**
\`\`\`typescript
const data = await apiClient.get<ResponseType>("/endpoint", { params });
\`\`\`

**Note:** All API calls go through internal apiClient, never raw fetch.

### Validation
**Dominant Pattern:**
\`\`\`typescript
const schema = z.object({ ... });
const validated = schema.parse(input);
\`\`\`

### Authentication Checks
**Dominant Pattern:**
\`\`\`typescript
const session = await getSession();
if (!session) throw new AuthError("UNAUTHORIZED");
```

### Logging
**Dominant Pattern:**
\`\`\`typescript
logger.info("action", { userId, ...context });
\`\`\`

**Note:** Structured logging with context object, not string interpolation.
</output-format>

<rules>
- Find the DOMINANT pattern, not all variations
- Note if there's no clear dominant pattern
- Include file counts to show pattern prevalence
- Focus on patterns that affect code generation
</rules>`;

export const codeClustererAgent: AgentConfig = {
  description: "Groups similar code patterns across the codebase",
  mode: "subagent",
  temperature: 0.2,
  tools: {
    write: false,
    edit: false,
    bash: false,
    task: false,
  },
  prompt: PROMPT,
};
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/whitemonk/projects/config/micode && npm test -- tests/agents/mindmodel/code-clusterer.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/agents/mindmodel/code-clusterer.ts tests/agents/mindmodel/code-clusterer.test.ts
git commit -m "feat(mindmodel): add code-clusterer agent"
```

---

### Task 8: Anti-Pattern Detector Agent

**Files:**
- Create: `src/agents/mindmodel/anti-pattern-detector.ts`
- Test: `tests/agents/mindmodel/anti-pattern-detector.test.ts`

**Step 1: Write test**

```typescript
// tests/agents/mindmodel/anti-pattern-detector.test.ts
import { describe, expect, it } from "bun:test";
import { antiPatternDetectorAgent } from "../../../src/agents/mindmodel/anti-pattern-detector";

describe("anti-pattern-detector agent", () => {
  it("should be a subagent", () => {
    expect(antiPatternDetectorAgent.mode).toBe("subagent");
  });

  it("should have read-only tool access", () => {
    expect(antiPatternDetectorAgent.tools?.write).toBe(false);
    expect(antiPatternDetectorAgent.tools?.edit).toBe(false);
    expect(antiPatternDetectorAgent.tools?.bash).toBe(false);
  });

  it("should have prompt that finds inconsistencies", () => {
    expect(antiPatternDetectorAgent.prompt).toContain("inconsisten");
    expect(antiPatternDetectorAgent.prompt).toContain("anti-pattern");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/whitemonk/projects/config/micode && npm test -- tests/agents/mindmodel/anti-pattern-detector.test.ts`
Expected: FAIL - module not found

**Step 3: Implement agent**

```typescript
// src/agents/mindmodel/anti-pattern-detector.ts
import type { AgentConfig } from "@opencode-ai/sdk";

const PROMPT = `<environment>
You are running as part of the "micode" OpenCode plugin.
You are a SUBAGENT for mindmodel generation - detecting anti-patterns and inconsistencies.
</environment>

<purpose>
Find code that deviates from the dominant patterns - these are potential anti-patterns:
1. Inconsistencies ("80% do X, but 3 files do Y")
2. Deprecated approaches still in use
3. Direct library usage instead of wrappers
4. Missing error handling
5. Style violations
</purpose>

<process>
1. Compare findings from code-clusterer against individual files
2. Flag files that don't follow the dominant pattern
3. Look for:
   - Raw fetch when apiClient exists
   - console.log when logger exists
   - Manual error handling when error HOF exists
   - Direct DB queries when repository exists
   - Inline styles when design system exists
4. Categorize by severity:
   - Critical: Security issues, data integrity
   - Warning: Inconsistency, maintenance burden
   - Info: Style preference, minor deviation
</process>

<output-format>
## Anti-Pattern Analysis

### Critical Issues
| File | Issue | Recommendation |
|------|-------|----------------|
| src/api/legacy.ts | Raw SQL queries (injection risk) | Use parameterized queries via repository |
| src/auth/old-handler.ts | Password in logs | Remove sensitive data from logging |

### Inconsistencies (80/20 Rule Violations)
| Pattern | Dominant Approach | Deviation | Files |
|---------|-------------------|-----------|-------|
| API calls | apiClient.get() | raw fetch() | src/utils/external.ts, src/legacy/api.ts |
| Logging | logger.info() | console.log() | src/scripts/*.ts (5 files) |
| Error handling | AppError class | generic Error | src/old/*.ts (3 files) |

### Deprecated Patterns Found
| Pattern | Found In | Should Use Instead |
|---------|----------|-------------------|
| moment.js | src/utils/date.ts | date-fns (already in deps) |
| class components | src/components/Legacy.tsx | functional components |

### Recommendations for .mindmodel/
Based on these findings, include these anti-patterns:

**patterns/error-handling.md:**
\`\`\`typescript
// DON'T: Generic error without context
throw new Error("Failed");

// DO: Typed error with context
throw new AppError("USER_NOT_FOUND", { userId });
\`\`\`

**patterns/data-fetching.md:**
\`\`\`typescript
// DON'T: Raw fetch
const res = await fetch("/api/users");

// DO: Internal client with error handling
const users = await apiClient.get<User[]>("/users");
\`\`\`
</output-format>

<rules>
- Only flag things that are genuinely inconsistent
- Don't flag intentional exceptions (e.g., scripts, tests)
- Severity matters: security > consistency > style
- Generate specific anti-pattern examples for .mindmodel/
</rules>`;

export const antiPatternDetectorAgent: AgentConfig = {
  description: "Finds inconsistencies and anti-patterns in the codebase",
  mode: "subagent",
  temperature: 0.2,
  tools: {
    write: false,
    edit: false,
    bash: false,
    task: false,
  },
  prompt: PROMPT,
};
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/whitemonk/projects/config/micode && npm test -- tests/agents/mindmodel/anti-pattern-detector.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/agents/mindmodel/anti-pattern-detector.ts tests/agents/mindmodel/anti-pattern-detector.test.ts
git commit -m "feat(mindmodel): add anti-pattern-detector agent"
```

---

### Task 9: Constraint Writer Agent

**Files:**
- Create: `src/agents/mindmodel/constraint-writer.ts`
- Test: `tests/agents/mindmodel/constraint-writer.test.ts`

**Step 1: Write test**

```typescript
// tests/agents/mindmodel/constraint-writer.test.ts
import { describe, expect, it } from "bun:test";
import { constraintWriterAgent } from "../../../src/agents/mindmodel/constraint-writer";

describe("constraint-writer agent", () => {
  it("should be a subagent", () => {
    expect(constraintWriterAgent.mode).toBe("subagent");
  });

  it("should have write access but not bash", () => {
    expect(constraintWriterAgent.tools?.write).not.toBe(false);
    expect(constraintWriterAgent.tools?.bash).toBe(false);
  });

  it("should have prompt that assembles .mindmodel/ structure", () => {
    expect(constraintWriterAgent.prompt).toContain(".mindmodel");
    expect(constraintWriterAgent.prompt).toContain("manifest");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/whitemonk/projects/config/micode && npm test -- tests/agents/mindmodel/constraint-writer.test.ts`
Expected: FAIL - module not found

**Step 3: Implement agent**

```typescript
// src/agents/mindmodel/constraint-writer.ts
import type { AgentConfig } from "@opencode-ai/sdk";

const PROMPT = `<environment>
You are running as part of the "micode" OpenCode plugin.
You are a SUBAGENT for mindmodel generation - writing the final .mindmodel/ structure.
</environment>

<purpose>
Take analysis outputs from other agents and assemble them into the .mindmodel/ directory:
1. Create directory structure (stack/, architecture/, patterns/, style/, components/, domain/, ops/)
2. Write constraint files with rules, examples, and anti-patterns
3. Generate manifest.yaml with all categories
4. Create system.md overview
</purpose>

<input>
You will receive analysis from:
- stack-detector: Tech stack info
- dependency-mapper: Library usage
- convention-extractor: Coding conventions
- domain-extractor: Business terminology
- code-clusterer: Code patterns
- anti-pattern-detector: Anti-patterns
- pattern-discoverer: Pattern categories
- example-extractor: Code examples

Combine these into a coherent constraint structure.
</input>

<output-structure>
.mindmodel/
├── manifest.yaml
├── system.md
├── stack/
│   ├── frontend.md (if applicable)
│   ├── backend.md (if applicable)
│   ├── database.md (if applicable)
│   └── dependencies.md
├── architecture/
│   ├── layers.md
│   └── organization.md
├── patterns/
│   ├── error-handling.md
│   ├── logging.md
│   ├── validation.md
│   ├── data-fetching.md
│   └── testing.md
├── style/
│   ├── naming.md
│   ├── imports.md
│   └── types.md
├── components/
│   ├── ui.md (if frontend)
│   └── shared.md
├── domain/
│   └── concepts.md
└── ops/
    └── database.md (if applicable)
</output-structure>

<file-format>
Each constraint file must follow this format:

\`\`\`markdown
# [Category Name]

## Rules
- Rule 1: Clear, actionable statement
- Rule 2: Another rule

## Examples

### [Pattern Name]
\`\`\`[language]
// Example code
\`\`\`

## Anti-patterns

### [What NOT to do]
\`\`\`[language]
// BAD: Explanation
bad code here
\`\`\`
\`\`\`
</file-format>

<manifest-format>
\`\`\`yaml
name: [project-name]
version: 2
categories:
  - path: stack/frontend.md
    description: Frontend frameworks and libraries
    group: stack
  - path: patterns/error-handling.md
    description: Error handling patterns and best practices
    group: patterns
  # ... more categories
\`\`\`
</manifest-format>

<rules>
- Only create files for categories that have content
- Skip empty categories (e.g., no frontend = no stack/frontend.md)
- Keep each file focused and concise
- Include 2-3 examples and 1-2 anti-patterns per file
- Ensure manifest.yaml lists all created files
</rules>`;

export const constraintWriterAgent: AgentConfig = {
  description: "Assembles analysis into .mindmodel/ structure",
  mode: "subagent",
  temperature: 0.2,
  maxTokens: 16000,
  tools: {
    bash: false,
    task: false,
  },
  prompt: PROMPT,
};
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/whitemonk/projects/config/micode && npm test -- tests/agents/mindmodel/constraint-writer.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/agents/mindmodel/constraint-writer.ts tests/agents/mindmodel/constraint-writer.test.ts
git commit -m "feat(mindmodel): add constraint-writer agent"
```

---

### Task 10: Constraint Reviewer Agent

**Files:**
- Create: `src/agents/mindmodel/constraint-reviewer.ts`
- Test: `tests/agents/mindmodel/constraint-reviewer.test.ts`

**Step 1: Write test**

```typescript
// tests/agents/mindmodel/constraint-reviewer.test.ts
import { describe, expect, it } from "bun:test";
import { constraintReviewerAgent } from "../../../src/agents/mindmodel/constraint-reviewer";

describe("constraint-reviewer agent", () => {
  it("should be a subagent", () => {
    expect(constraintReviewerAgent.mode).toBe("subagent");
  });

  it("should have read-only tool access", () => {
    expect(constraintReviewerAgent.tools?.write).toBe(false);
    expect(constraintReviewerAgent.tools?.edit).toBe(false);
    expect(constraintReviewerAgent.tools?.bash).toBe(false);
  });

  it("should have prompt that reviews code against constraints", () => {
    expect(constraintReviewerAgent.prompt).toContain("violation");
    expect(constraintReviewerAgent.prompt).toContain("constraint");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/whitemonk/projects/config/micode && npm test -- tests/agents/mindmodel/constraint-reviewer.test.ts`
Expected: FAIL - module not found

**Step 3: Implement agent**

```typescript
// src/agents/mindmodel/constraint-reviewer.ts
import type { AgentConfig } from "@opencode-ai/sdk";

const PROMPT = `<environment>
You are running as part of the "micode" OpenCode plugin.
You are a SUBAGENT for constraint enforcement - reviewing generated code.
</environment>

<purpose>
Review generated code against project constraints and report violations.
You will receive:
1. The generated code (new or modified)
2. The relevant constraint files
3. The original task description
</purpose>

<process>
1. Read the generated code carefully
2. For each constraint file:
   - Check rules: Does the code follow each rule?
   - Check examples: Does the code match the expected patterns?
   - Check anti-patterns: Does the code avoid the forbidden patterns?
3. Categorize findings:
   - VIOLATION: Code breaks a rule or matches an anti-pattern
   - PASS: Code follows constraints
</process>

<output-format>
If violations found:
\`\`\`json
{
  "status": "BLOCKED",
  "violations": [
    {
      "file": "src/api/user.ts",
      "line": 15,
      "rule": "Always use internal apiClient for API calls",
      "constraint_file": "patterns/data-fetching.md",
      "found": "fetch('/api/users')",
      "expected": "apiClient.get<User[]>('/users')"
    },
    {
      "file": "src/api/user.ts",
      "line": 23,
      "rule": "Never swallow errors silently",
      "constraint_file": "patterns/error-handling.md",
      "found": "catch (e) { return null }",
      "expected": "catch (e) { throw new AppError('FETCH_FAILED', e) }"
    }
  ],
  "summary": "Found 2 constraint violations. See patterns/data-fetching.md and patterns/error-handling.md for correct patterns."
}
\`\`\`

If no violations:
\`\`\`json
{
  "status": "PASS",
  "violations": [],
  "summary": "Code follows all project constraints."
}
\`\`\`
</output-format>

<rules>
- Be strict: If a rule says "always" or "never", enforce it
- Be specific: Include line numbers and exact code snippets
- Be helpful: Show what was found AND what was expected
- Reference constraint files so user can learn more
- JSON output only - no additional text
</rules>`;

export const constraintReviewerAgent: AgentConfig = {
  description: "Reviews generated code against project constraints",
  mode: "subagent",
  temperature: 0.1, // Low temperature for consistent reviews
  tools: {
    write: false,
    edit: false,
    bash: false,
    task: false,
  },
  prompt: PROMPT,
};
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/whitemonk/projects/config/micode && npm test -- tests/agents/mindmodel/constraint-reviewer.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/agents/mindmodel/constraint-reviewer.ts tests/agents/mindmodel/constraint-reviewer.test.ts
git commit -m "feat(mindmodel): add constraint-reviewer agent"
```

---

### Task 11: Update Mindmodel Agents Index

**Files:**
- Modify: `src/agents/mindmodel/index.ts`

**Step 1: Update exports**

```typescript
// src/agents/mindmodel/index.ts
export { antiPatternDetectorAgent } from "./anti-pattern-detector";
export { codeClustererAgent } from "./code-clusterer";
export { constraintReviewerAgent } from "./constraint-reviewer";
export { constraintWriterAgent } from "./constraint-writer";
export { conventionExtractorAgent } from "./convention-extractor";
export { dependencyMapperAgent } from "./dependency-mapper";
export { domainExtractorAgent } from "./domain-extractor";
export { exampleExtractorAgent } from "./example-extractor";
export { mindmodelOrchestratorAgent } from "./orchestrator";
export { mindmodelPatternDiscovererAgent } from "./pattern-discoverer";
export { stackDetectorAgent } from "./stack-detector";
```

**Step 2: Commit**

```bash
git add src/agents/mindmodel/index.ts
git commit -m "feat(mindmodel): export all new agents from index"
```

---

### Task 12: Register New Agents

**Files:**
- Modify: `src/agents/index.ts`

**Step 1: Update imports and registration**

```typescript
// src/agents/index.ts - update imports
import {
  antiPatternDetectorAgent,
  codeClustererAgent,
  constraintReviewerAgent,
  constraintWriterAgent,
  conventionExtractorAgent,
  dependencyMapperAgent,
  domainExtractorAgent,
  exampleExtractorAgent,
  mindmodelOrchestratorAgent,
  mindmodelPatternDiscovererAgent,
  stackDetectorAgent,
} from "./mindmodel";

// Add to agents record after existing mm-* entries:
  "mm-dependency-mapper": { ...dependencyMapperAgent, model: "openai/gpt-5.2-codex" },
  "mm-convention-extractor": { ...conventionExtractorAgent, model: "openai/gpt-5.2-codex" },
  "mm-domain-extractor": { ...domainExtractorAgent, model: "openai/gpt-5.2-codex" },
  "mm-code-clusterer": { ...codeClustererAgent, model: "openai/gpt-5.2-codex" },
  "mm-anti-pattern-detector": { ...antiPatternDetectorAgent, model: "openai/gpt-5.2-codex" },
  "mm-constraint-writer": { ...constraintWriterAgent, model: "openai/gpt-5.2-codex" },
  "mm-constraint-reviewer": { ...constraintReviewerAgent, model: "openai/gpt-5.2-codex" },
```

**Step 2: Run tests**

Run: `cd /Users/whitemonk/projects/config/micode && npm test`
Expected: All tests pass

**Step 3: Commit**

```bash
git add src/agents/index.ts
git commit -m "feat(mindmodel): register all v2 agents"
```

---

## Phase 3: Update Orchestrator

### Task 13: Update Orchestrator for 4-Phase Pipeline

**Files:**
- Modify: `src/agents/mindmodel/orchestrator.ts`
- Test: `tests/agents/mindmodel/orchestrator.test.ts`

**Step 1: Update orchestrator prompt**

```typescript
// src/agents/mindmodel/orchestrator.ts
import type { AgentConfig } from "@opencode-ai/sdk";

const PROMPT = `<environment>
You are running as part of the "micode" OpenCode plugin.
You are the ORCHESTRATOR for mindmodel v2 generation.
</environment>

<purpose>
Coordinate a 4-phase deep analysis pipeline to generate .mindmodel/ for this project.
</purpose>

<agents>
Phase 1 - Discovery (run in parallel):
- mm-stack-detector: Identifies tech stack
- mm-dependency-mapper: Maps library usage
- mm-convention-extractor: Extracts coding conventions
- mm-domain-extractor: Extracts business terminology

Phase 2 - Pattern Analysis (run in parallel):
- mm-code-clusterer: Groups similar code patterns
- mm-pattern-discoverer: Identifies pattern categories
- mm-anti-pattern-detector: Finds inconsistencies

Phase 3 - Extraction (run in parallel per category):
- mm-example-extractor: Extracts examples for each category

Phase 4 - Assembly:
- mm-constraint-writer: Assembles everything into .mindmodel/
</agents>

<process>
1. PHASE 1: Spawn these agents in PARALLEL using spawn_agent tool:
   - mm-stack-detector
   - mm-dependency-mapper
   - mm-convention-extractor
   - mm-domain-extractor

   Wait for all to complete. Collect their outputs.

2. PHASE 2: Spawn these agents in PARALLEL:
   - mm-code-clusterer (provide Phase 1 findings as context)
   - mm-pattern-discoverer (provide stack info as context)
   - mm-anti-pattern-detector (provide pattern findings as context)

   Wait for all to complete. Collect their outputs.

3. PHASE 3: For each pattern category discovered:
   - Spawn mm-example-extractor with category + patterns as context
   - Can run multiple extractors in parallel

   Wait for all to complete. Collect examples.

4. PHASE 4: Spawn mm-constraint-writer with ALL collected outputs:
   - Stack info
   - Dependency analysis
   - Conventions
   - Domain glossary
   - Code patterns
   - Anti-patterns
   - Extracted examples

   This agent writes the final .mindmodel/ structure.

5. Verify the output:
   - Check .mindmodel/manifest.yaml exists
   - Check .mindmodel/system.md exists
   - Report summary of created files
</process>

<output>
After completion, report:
- Total categories created
- Files written
- Any issues encountered
- Suggested next steps (e.g., "Review patterns/error-handling.md for accuracy")
</output>

<rules>
- Always use spawn_agent for parallel execution
- Pass relevant context between phases
- Don't skip phases - each builds on the previous
- If a phase fails, report error and stop
</rules>`;

export const mindmodelOrchestratorAgent: AgentConfig = {
  description: "Orchestrates 4-phase mindmodel v2 generation pipeline",
  mode: "subagent",
  temperature: 0.2,
  maxTokens: 32000,
  tools: {
    bash: false,
  },
  prompt: PROMPT,
};
```

**Step 2: Update test**

```typescript
// tests/agents/mindmodel/orchestrator.test.ts - update test
it("should reference all v2 phase agents", () => {
  const prompt = mindmodelOrchestratorAgent.prompt;
  // Phase 1
  expect(prompt).toContain("mm-stack-detector");
  expect(prompt).toContain("mm-dependency-mapper");
  expect(prompt).toContain("mm-convention-extractor");
  expect(prompt).toContain("mm-domain-extractor");
  // Phase 2
  expect(prompt).toContain("mm-code-clusterer");
  expect(prompt).toContain("mm-pattern-discoverer");
  expect(prompt).toContain("mm-anti-pattern-detector");
  // Phase 3
  expect(prompt).toContain("mm-example-extractor");
  // Phase 4
  expect(prompt).toContain("mm-constraint-writer");
});
```

**Step 3: Run tests**

Run: `cd /Users/whitemonk/projects/config/micode && npm test -- tests/agents/mindmodel/orchestrator.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add src/agents/mindmodel/orchestrator.ts tests/agents/mindmodel/orchestrator.test.ts
git commit -m "feat(mindmodel): update orchestrator for 4-phase v2 pipeline"
```

---

## Phase 4: Enforcement Hook

### Task 14: Create Constraint Review Types

**Files:**
- Create: `src/mindmodel/review.ts`
- Test: `tests/mindmodel/review.test.ts`

**Step 1: Write test**

```typescript
// tests/mindmodel/review.test.ts
import { describe, expect, it } from "bun:test";
import { parseReviewResponse, type ReviewResult } from "../../../src/mindmodel/review";

describe("parseReviewResponse", () => {
  it("should parse PASS response", () => {
    const response = `\`\`\`json
{
  "status": "PASS",
  "violations": [],
  "summary": "Code follows all constraints."
}
\`\`\``;
    const result = parseReviewResponse(response);
    expect(result.status).toBe("PASS");
    expect(result.violations).toHaveLength(0);
  });

  it("should parse BLOCKED response with violations", () => {
    const response = `\`\`\`json
{
  "status": "BLOCKED",
  "violations": [
    {
      "file": "src/api.ts",
      "line": 15,
      "rule": "Use internal client",
      "constraint_file": "patterns/api.md",
      "found": "fetch()",
      "expected": "apiClient.get()"
    }
  ],
  "summary": "Found 1 violation."
}
\`\`\``;
    const result = parseReviewResponse(response);
    expect(result.status).toBe("BLOCKED");
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].file).toBe("src/api.ts");
  });

  it("should handle raw JSON without code blocks", () => {
    const response = `{"status": "PASS", "violations": [], "summary": "OK"}`;
    const result = parseReviewResponse(response);
    expect(result.status).toBe("PASS");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/whitemonk/projects/config/micode && npm test -- tests/mindmodel/review.test.ts`
Expected: FAIL - module not found

**Step 3: Implement**

```typescript
// src/mindmodel/review.ts
export interface Violation {
  file: string;
  line?: number;
  rule: string;
  constraint_file: string;
  found: string;
  expected: string;
}

export interface ReviewResult {
  status: "PASS" | "BLOCKED";
  violations: Violation[];
  summary: string;
}

export function parseReviewResponse(response: string): ReviewResult {
  // Extract JSON from markdown code blocks if present
  const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = jsonMatch ? jsonMatch[1].trim() : response.trim();

  try {
    const parsed = JSON.parse(jsonStr);
    return {
      status: parsed.status === "PASS" ? "PASS" : "BLOCKED",
      violations: parsed.violations || [],
      summary: parsed.summary || "",
    };
  } catch {
    // If JSON parsing fails, assume PASS to avoid false blocks
    return {
      status: "PASS",
      violations: [],
      summary: "Failed to parse review response",
    };
  }
}

export function formatViolationsForRetry(violations: Violation[]): string {
  if (violations.length === 0) return "";

  const lines = ["The previous attempt had constraint violations:", ""];

  for (const v of violations) {
    lines.push(`- ${v.file}${v.line ? `:${v.line}` : ""}: ${v.rule}`);
    lines.push(`  Found: ${v.found}`);
    lines.push(`  Expected: ${v.expected}`);
    lines.push(`  See: ${v.constraint_file}`);
    lines.push("");
  }

  lines.push("Please fix these issues in your next attempt.");

  return lines.join("\n");
}

export function formatViolationsForUser(violations: Violation[]): string {
  if (violations.length === 0) return "";

  const lines = ["❌ Blocked: This code violates project constraints:", ""];

  for (const v of violations) {
    lines.push(`- ${v.rule} (see ${v.constraint_file})`);
    lines.push(`  File: ${v.file}${v.line ? `:${v.line}` : ""}`);
  }

  return lines.join("\n");
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/whitemonk/projects/config/micode && npm test -- tests/mindmodel/review.test.ts`
Expected: PASS

**Step 5: Export from index**

```typescript
// src/mindmodel/index.ts - add exports
export {
  parseReviewResponse,
  formatViolationsForRetry,
  formatViolationsForUser,
  type ReviewResult,
  type Violation,
} from "./review";
```

**Step 6: Commit**

```bash
git add src/mindmodel/review.ts src/mindmodel/index.ts tests/mindmodel/review.test.ts
git commit -m "feat(mindmodel): add review result types and formatters"
```

---

### Task 15: Create Constraint Reviewer Hook

**Files:**
- Create: `src/hooks/constraint-reviewer.ts`
- Test: `tests/hooks/constraint-reviewer.test.ts`

**Step 1: Write test**

```typescript
// tests/hooks/constraint-reviewer.test.ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("createConstraintReviewerHook", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "constraint-reviewer-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("should skip review when no mindmodel exists", async () => {
    const { createConstraintReviewerHook } = await import(
      "../../src/hooks/constraint-reviewer"
    );

    const mockCtx = { directory: tempDir } as any;
    const mockReviewFn = async () => '{"status": "BLOCKED", "violations": []}';

    const hook = createConstraintReviewerHook(mockCtx, mockReviewFn);

    const output = { output: "some code" };
    await hook["tool.execute.after"](
      { tool: "Write", sessionID: "test", args: { file_path: "test.ts" } },
      output
    );

    // Should not modify output when no mindmodel
    expect(output.output).toBe("some code");
  });

  it("should review Write operations when mindmodel exists", async () => {
    // Create minimal mindmodel
    await mkdir(join(tempDir, ".mindmodel"));
    await writeFile(
      join(tempDir, ".mindmodel", "manifest.yaml"),
      "name: test\nversion: 2\ncategories:\n  - path: test.md\n    description: Test"
    );
    await writeFile(join(tempDir, ".mindmodel", "test.md"), "# Test\n## Rules\n- Test rule");

    const { createConstraintReviewerHook } = await import(
      "../../src/hooks/constraint-reviewer"
    );

    let reviewCalled = false;
    const mockCtx = { directory: tempDir } as any;
    const mockReviewFn = async () => {
      reviewCalled = true;
      return '{"status": "PASS", "violations": [], "summary": "OK"}';
    };

    const hook = createConstraintReviewerHook(mockCtx, mockReviewFn);

    const output = { output: "some code" };
    await hook["tool.execute.after"](
      { tool: "Write", sessionID: "test", args: { file_path: join(tempDir, "test.ts") } },
      output
    );

    expect(reviewCalled).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/whitemonk/projects/config/micode && npm test -- tests/hooks/constraint-reviewer.test.ts`
Expected: FAIL - module not found

**Step 3: Implement hook**

```typescript
// src/hooks/constraint-reviewer.ts
import type { PluginInput } from "@opencode-ai/plugin";

import {
  formatViolationsForRetry,
  formatViolationsForUser,
  loadMindmodel,
  parseReviewResponse,
  type LoadedMindmodel,
  type ReviewResult,
} from "../mindmodel";
import { config } from "../utils/config";
import { log } from "../utils/logger";

type ReviewFn = (prompt: string) => Promise<string>;

interface ReviewState {
  retryCount: number;
  lastViolations: string;
  overrideActive: boolean;
}

export function createConstraintReviewerHook(ctx: PluginInput, reviewFn: ReviewFn) {
  let cachedMindmodel: LoadedMindmodel | null | undefined;
  const sessionState = new Map<string, ReviewState>();

  async function getMindmodel(): Promise<LoadedMindmodel | null> {
    if (cachedMindmodel === undefined) {
      cachedMindmodel = await loadMindmodel(ctx.directory);
    }
    return cachedMindmodel;
  }

  function getSessionState(sessionID: string): ReviewState {
    if (!sessionState.has(sessionID)) {
      sessionState.set(sessionID, {
        retryCount: 0,
        lastViolations: "",
        overrideActive: false,
      });
    }
    return sessionState.get(sessionID)!;
  }

  return {
    "tool.execute.after": async (
      input: { tool: string; sessionID: string; args?: Record<string, unknown> },
      output: { output?: string },
    ) => {
      // Only review Write and Edit operations
      if (!["Write", "Edit"].includes(input.tool)) return;
      if (!config.mindmodel.reviewEnabled) return;

      const mindmodel = await getMindmodel();
      if (!mindmodel) return;

      const state = getSessionState(input.sessionID);

      // Skip if override is active
      if (state.overrideActive) {
        state.overrideActive = false;
        return;
      }

      const filePath = input.args?.file_path as string | undefined;
      if (!filePath) return;

      try {
        // Build review prompt
        const reviewPrompt = buildReviewPrompt(
          output.output || "",
          filePath,
          mindmodel
        );

        // Call reviewer
        const reviewResponse = await reviewFn(reviewPrompt);
        const result = parseReviewResponse(reviewResponse);

        if (result.status === "PASS") {
          state.retryCount = 0;
          return;
        }

        // Handle violations
        if (state.retryCount < config.mindmodel.reviewMaxRetries) {
          // Trigger retry by modifying output
          state.retryCount++;
          state.lastViolations = formatViolationsForRetry(result.violations);
          output.output = `${output.output}\n\n<constraint-violations>\n${state.lastViolations}\n</constraint-violations>`;
        } else {
          // Max retries reached - block
          state.retryCount = 0;
          const userMessage = formatViolationsForUser(result.violations);
          throw new ConstraintViolationError(userMessage, result);
        }
      } catch (error) {
        if (error instanceof ConstraintViolationError) {
          throw error;
        }
        // Log but don't block on review failures
        log.warn("mindmodel", `Review failed: ${error instanceof Error ? error.message : "unknown"}`);
      }
    },

    "chat.message": async (
      input: { sessionID: string },
      output: { parts: Array<{ type: string; text?: string }> },
    ) => {
      // Check for override command
      const text = output.parts
        .filter((p) => p.type === "text" && p.text)
        .map((p) => p.text)
        .join(" ");

      const overrideMatch = text.match(/^override:\s*(.+)$/im);
      if (overrideMatch) {
        const state = getSessionState(input.sessionID);
        state.overrideActive = true;

        // Log the override
        const reason = overrideMatch[1].trim();
        await logOverride(ctx.directory, reason);

        log.info("mindmodel", `Override activated: ${reason}`);
      }
    },
  };
}

function buildReviewPrompt(
  code: string,
  filePath: string,
  mindmodel: LoadedMindmodel
): string {
  // For now, include all constraints - selective loading can be added later
  const constraintSummary = mindmodel.manifest.categories
    .map((c) => `- ${c.path}: ${c.description}`)
    .join("\n");

  return `Review this generated code against project constraints.

File: ${filePath}

Code:
\`\`\`
${code}
\`\`\`

Available constraints:
${constraintSummary}

Return JSON with status "PASS" or "BLOCKED" and any violations found.`;
}

async function logOverride(projectDir: string, reason: string): Promise<void> {
  const { appendFile, mkdir } = await import("node:fs/promises");
  const { join } = await import("node:path");

  const logPath = join(projectDir, ".mindmodel", config.mindmodel.overrideLogFile);
  const timestamp = new Date().toISOString();
  const entry = `${timestamp} | override | reason: "${reason}"\n`;

  try {
    await mkdir(join(projectDir, ".mindmodel"), { recursive: true });
    await appendFile(logPath, entry);
  } catch {
    // Ignore logging failures
  }
}

export class ConstraintViolationError extends Error {
  constructor(
    message: string,
    public readonly result: ReviewResult
  ) {
    super(message);
    this.name = "ConstraintViolationError";
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/whitemonk/projects/config/micode && npm test -- tests/hooks/constraint-reviewer.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/hooks/constraint-reviewer.ts tests/hooks/constraint-reviewer.test.ts
git commit -m "feat(mindmodel): add constraint-reviewer hook with retry and override"
```

---

### Task 16: Integrate Reviewer Hook into Plugin

**Files:**
- Modify: `src/index.ts`

**Step 1: Add import and hook creation**

```typescript
// src/index.ts - add import
import { createConstraintReviewerHook } from "./hooks/constraint-reviewer";

// After mindmodelInjectorHook creation, add:
  // Constraint reviewer hook - reviews generated code against .mindmodel/ constraints
  const constraintReviewerHook = createConstraintReviewerHook(ctx, async (reviewPrompt) => {
    let sessionId: string | undefined;
    try {
      const sessionResult = await ctx.client.session.create({
        body: { title: "constraint-reviewer" },
      });

      if (!sessionResult.data?.id) {
        log.warn("mindmodel", "Failed to create reviewer session");
        return '{"status": "PASS", "violations": [], "summary": "Review skipped"}';
      }
      sessionId = sessionResult.data.id;

      const promptResult = await ctx.client.session.prompt({
        path: { id: sessionId },
        body: {
          agent: "mm-constraint-reviewer",
          tools: {},
          parts: [{ type: "text", text: reviewPrompt }],
        },
      });

      if (!promptResult.data?.parts) {
        return '{"status": "PASS", "violations": [], "summary": "Empty response"}';
      }

      let responseText = "";
      for (const part of promptResult.data.parts) {
        if (part.type === "text" && "text" in part) {
          responseText += (part as { text: string }).text;
        }
      }

      return responseText;
    } catch (error) {
      log.warn("mindmodel", `Reviewer failed: ${error instanceof Error ? error.message : "unknown"}`);
      return '{"status": "PASS", "violations": [], "summary": "Review failed"}';
    } finally {
      if (sessionId) {
        await ctx.client.session.delete({ path: { id: sessionId } }).catch(() => {});
      }
    }
  });
```

**Step 2: Add hook to tool.execute.after**

```typescript
// In "tool.execute.after" handler, add after existing hooks:
      // Constraint review for Edit/Write
      await constraintReviewerHook["tool.execute.after"](
        { tool: input.tool, sessionID: input.sessionID, args: input.args },
        output
      );
```

**Step 3: Add hook to chat.message**

```typescript
// In "chat.message" handler, add:
      // Check for override command
      await constraintReviewerHook["chat.message"](input, output);
```

**Step 4: Run tests**

Run: `cd /Users/whitemonk/projects/config/micode && npm test`
Expected: All tests pass

**Step 5: Commit**

```bash
git add src/index.ts
git commit -m "feat(mindmodel): integrate constraint-reviewer hook into plugin"
```

---

## Phase 5: Final Integration

### Task 17: Update /init Command

**Files:**
- Modify: `src/index.ts`

**Step 1: Update init command to use orchestrator**

The /mindmodel command already uses mm-orchestrator. Verify it works with the updated orchestrator.

```typescript
// Verify this exists in src/index.ts config.command section:
        mindmodel: {
          description: "Generate .mindmodel/ with code examples from this project",
          agent: "mm-orchestrator",
          template: `Generate mindmodel for this project. $ARGUMENTS`,
        },
```

**Step 2: Add /init as alias**

```typescript
// Add init as alias for mindmodel
        init: {
          description: "Initialize project with .mindmodel/ constraints (alias for /mindmodel)",
          agent: "mm-orchestrator",
          template: `Generate mindmodel for this project. $ARGUMENTS`,
        },
```

**Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat(mindmodel): add /init as alias for /mindmodel command"
```

---

### Task 18: Full Integration Test

**Files:**
- Create: `tests/integration/mindmodel-v2.test.ts`

**Step 1: Write integration test**

```typescript
// tests/integration/mindmodel-v2.test.ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("mindmodel v2 integration", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "mindmodel-v2-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("should load v2 manifest with groups", async () => {
    const { loadMindmodel } = await import("../../src/mindmodel");

    await mkdir(join(tempDir, ".mindmodel", "patterns"), { recursive: true });
    await writeFile(
      join(tempDir, ".mindmodel", "manifest.yaml"),
      `name: test-project
version: 2
categories:
  - path: patterns/error-handling.md
    description: Error handling patterns
    group: patterns`
    );
    await writeFile(
      join(tempDir, ".mindmodel", "patterns", "error-handling.md"),
      `# Error Handling

## Rules
- Always wrap errors with context

## Examples

### Basic error wrapping
\`\`\`typescript
throw new Error("wrapped");
\`\`\`
`
    );

    const mindmodel = await loadMindmodel(tempDir);
    expect(mindmodel).not.toBeNull();
    expect(mindmodel!.manifest.version).toBe(2);
    expect(mindmodel!.manifest.categories[0].group).toBe("patterns");
  });

  it("should parse constraint files with rules and examples", async () => {
    const { parseConstraintFile } = await import("../../src/mindmodel");

    const content = `# Test Category

## Rules
- Rule one
- Rule two

## Examples

### Example one
\`\`\`typescript
const x = 1;
\`\`\`

## Anti-patterns

### Bad practice
\`\`\`typescript
const x = undefined;
\`\`\`
`;

    const parsed = parseConstraintFile(content);
    expect(parsed.title).toBe("Test Category");
    expect(parsed.rules).toHaveLength(2);
    expect(parsed.examples).toHaveLength(1);
    expect(parsed.antiPatterns).toHaveLength(1);
  });

  it("should format review violations for user", async () => {
    const { formatViolationsForUser } = await import("../../src/mindmodel");

    const violations = [
      {
        file: "src/api.ts",
        line: 15,
        rule: "Use internal client",
        constraint_file: "patterns/api.md",
        found: "fetch()",
        expected: "apiClient.get()",
      },
    ];

    const formatted = formatViolationsForUser(violations);
    expect(formatted).toContain("❌ Blocked");
    expect(formatted).toContain("Use internal client");
    expect(formatted).toContain("patterns/api.md");
  });
});
```

**Step 2: Run test**

Run: `cd /Users/whitemonk/projects/config/micode && npm test -- tests/integration/mindmodel-v2.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add tests/integration/mindmodel-v2.test.ts
git commit -m "test(mindmodel): add v2 integration tests"
```

---

### Task 19: Run Full Test Suite

**Step 1: Run all tests**

Run: `cd /Users/whitemonk/projects/config/micode && npm test`
Expected: All tests pass

**Step 2: Run TypeScript check**

Run: `cd /Users/whitemonk/projects/config/micode && npx tsc --noEmit`
Expected: No errors

**Step 3: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix(mindmodel): address any remaining issues from v2 implementation"
```

---

## Summary

### New Files Created
- `src/agents/mindmodel/dependency-mapper.ts`
- `src/agents/mindmodel/convention-extractor.ts`
- `src/agents/mindmodel/domain-extractor.ts`
- `src/agents/mindmodel/code-clusterer.ts`
- `src/agents/mindmodel/anti-pattern-detector.ts`
- `src/agents/mindmodel/constraint-writer.ts`
- `src/agents/mindmodel/constraint-reviewer.ts`
- `src/mindmodel/review.ts`
- `src/hooks/constraint-reviewer.ts`
- Tests for all new modules

### Modified Files
- `src/mindmodel/types.ts` - Added group field, constraint file parser
- `src/mindmodel/index.ts` - Export new types
- `src/utils/config.ts` - Added mindmodel v2 config
- `src/agents/mindmodel/index.ts` - Export all agents
- `src/agents/mindmodel/orchestrator.ts` - Updated for 4-phase pipeline
- `src/agents/index.ts` - Register all new agents
- `src/index.ts` - Integrate reviewer hook, add /init alias

### New Agents
| Agent | Purpose |
|-------|---------|
| mm-dependency-mapper | Maps imports, finds approved vs one-off libraries |
| mm-convention-extractor | Analyzes naming, style across codebase |
| mm-domain-extractor | Extracts business terms from types/comments |
| mm-code-clusterer | Groups similar code to find patterns |
| mm-anti-pattern-detector | Finds inconsistencies in codebase |
| mm-constraint-writer | Assembles .mindmodel/ from analysis |
| mm-constraint-reviewer | Reviews generated code against constraints |

### Total Tasks: 19
