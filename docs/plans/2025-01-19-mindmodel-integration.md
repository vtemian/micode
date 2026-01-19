# Mindmodel Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Integrate mindmodel (few-shot learning through selective context injection) into micode, replacing ARCHITECTURE.md + CODE_STYLE.md with a structured `.mindmodel/` directory containing categorized code examples.

**Architecture:** A new hook (`mindmodel-injector`) classifies incoming tasks using a fast LLM call, then injects relevant examples from `.mindmodel/` into the agent's context. The `/init` command is migrated to generate `.mindmodel/` using a multi-agent workflow with parallel subagents for discovery, extraction, and annotation.

**Tech Stack:** TypeScript, Bun, OpenCode Plugin SDK, valibot for schema validation, yaml for parsing

---

## Phase 0: Prerequisites

### Task 0: Add yaml dependency

**Step 1: Install yaml package**

Run: `cd /Users/whitemonk/projects/config/micode/.worktrees/mindmodel && bun add yaml`
Expected: Package added to dependencies

**Step 2: Commit**

```bash
cd /Users/whitemonk/projects/config/micode/.worktrees/mindmodel && git add package.json bun.lock && git commit -m "chore: add yaml dependency for mindmodel"
```

---

## Phase 1: Core Infrastructure

### Task 1: Mindmodel Types and Schema

**Files:**
- Create: `src/mindmodel/types.ts`
- Test: `tests/mindmodel/types.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/mindmodel/types.test.ts
import { describe, it, expect } from "bun:test";
import { parseManifest, type MindmodelManifest } from "../../src/mindmodel/types";

describe("mindmodel types", () => {
  it("should parse a valid manifest", () => {
    const yaml = `
name: sisif-mindmodel
version: 1
categories:
  - path: components/button.md
    description: Button component patterns
  - path: components/form.md
    description: Form patterns with validation
  - path: patterns/data-fetching.md
    description: Data fetching with loading states
`;
    const result = parseManifest(yaml);
    expect(result.name).toBe("sisif-mindmodel");
    expect(result.categories).toHaveLength(3);
    expect(result.categories[0].path).toBe("components/button.md");
  });

  it("should reject invalid manifest missing required fields", () => {
    const yaml = `
name: test
categories: []
`;
    expect(() => parseManifest(yaml)).toThrow();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/whitemonk/projects/config/micode/.worktrees/mindmodel && bun test tests/mindmodel/types.test.ts`
Expected: FAIL with "Cannot find module"

**Step 3: Write minimal implementation**

```typescript
// src/mindmodel/types.ts
import * as v from "valibot";
import { parse as parseYaml } from "yaml";

export const CategorySchema = v.object({
  path: v.string(),
  description: v.string(),
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

Run: `cd /Users/whitemonk/projects/config/micode/.worktrees/mindmodel && bun test tests/mindmodel/types.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
cd /Users/whitemonk/projects/config/micode/.worktrees/mindmodel && git add src/mindmodel/types.ts tests/mindmodel/types.test.ts && git commit -m "feat(mindmodel): add types and manifest schema"
```

---

### Task 2: Mindmodel Loader

**Files:**
- Create: `src/mindmodel/loader.ts`
- Test: `tests/mindmodel/loader.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/mindmodel/loader.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadMindmodel, loadExamples } from "../../src/mindmodel/loader";

describe("mindmodel loader", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "mindmodel-loader-test-"));
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("should load mindmodel from .mindmodel directory", async () => {
    const mindmodelDir = join(testDir, ".mindmodel");
    mkdirSync(mindmodelDir, { recursive: true });

    writeFileSync(
      join(mindmodelDir, "manifest.yaml"),
      `
name: test-project
version: 1
categories:
  - path: components/button.md
    description: Button patterns
`
    );

    mkdirSync(join(mindmodelDir, "components"), { recursive: true });
    writeFileSync(
      join(mindmodelDir, "components/button.md"),
      "# Button\n\n```tsx example\n<Button>Click</Button>\n```"
    );

    const mindmodel = await loadMindmodel(testDir);
    expect(mindmodel).not.toBeNull();
    expect(mindmodel!.manifest.name).toBe("test-project");
  });

  it("should return null if .mindmodel directory does not exist", async () => {
    const mindmodel = await loadMindmodel(testDir);
    expect(mindmodel).toBeNull();
  });

  it("should load examples for specified categories", async () => {
    const mindmodelDir = join(testDir, ".mindmodel");
    mkdirSync(join(mindmodelDir, "components"), { recursive: true });
    mkdirSync(join(mindmodelDir, "patterns"), { recursive: true });

    writeFileSync(
      join(mindmodelDir, "manifest.yaml"),
      `
name: test
version: 1
categories:
  - path: components/button.md
    description: Button patterns
  - path: components/form.md
    description: Form patterns
  - path: patterns/data-fetching.md
    description: Data fetching
`
    );

    writeFileSync(join(mindmodelDir, "components/button.md"), "# Button\nButton content");
    writeFileSync(join(mindmodelDir, "components/form.md"), "# Form\nForm content");
    writeFileSync(join(mindmodelDir, "patterns/data-fetching.md"), "# Data Fetching\nFetch content");

    const mindmodel = await loadMindmodel(testDir);
    const examples = await loadExamples(mindmodel!, ["components/button.md", "patterns/data-fetching.md"]);

    expect(examples).toHaveLength(2);
    expect(examples[0].content).toContain("Button content");
    expect(examples[1].content).toContain("Fetch content");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/whitemonk/projects/config/micode/.worktrees/mindmodel && bun test tests/mindmodel/loader.test.ts`
Expected: FAIL with "Cannot find module"

**Step 3: Write minimal implementation**

```typescript
// src/mindmodel/loader.ts
import { readFile, access } from "node:fs/promises";
import { join } from "node:path";
import { parseManifest, type MindmodelManifest } from "./types";

export interface LoadedMindmodel {
  directory: string;
  manifest: MindmodelManifest;
}

export interface LoadedExample {
  path: string;
  description: string;
  content: string;
}

export async function loadMindmodel(projectDir: string): Promise<LoadedMindmodel | null> {
  const mindmodelDir = join(projectDir, ".mindmodel");

  try {
    await access(mindmodelDir);
  } catch {
    return null;
  }

  const manifestPath = join(mindmodelDir, "manifest.yaml");

  try {
    const manifestContent = await readFile(manifestPath, "utf-8");
    const manifest = parseManifest(manifestContent);

    return {
      directory: mindmodelDir,
      manifest,
    };
  } catch (error) {
    console.warn(`[micode] Failed to load mindmodel manifest: ${error}`);
    return null;
  }
}

export async function loadExamples(
  mindmodel: LoadedMindmodel,
  categoryPaths: string[]
): Promise<LoadedExample[]> {
  const examples: LoadedExample[] = [];

  for (const categoryPath of categoryPaths) {
    const category = mindmodel.manifest.categories.find((c) => c.path === categoryPath);
    if (!category) continue;

    const fullPath = join(mindmodel.directory, categoryPath);

    try {
      const content = await readFile(fullPath, "utf-8");
      examples.push({
        path: categoryPath,
        description: category.description,
        content,
      });
    } catch {
      console.warn(`[micode] Failed to load mindmodel example: ${categoryPath}`);
    }
  }

  return examples;
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/whitemonk/projects/config/micode/.worktrees/mindmodel && bun test tests/mindmodel/loader.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
cd /Users/whitemonk/projects/config/micode/.worktrees/mindmodel && git add src/mindmodel/loader.ts tests/mindmodel/loader.test.ts && git commit -m "feat(mindmodel): add loader for .mindmodel directory"
```

---

### Task 3: Mindmodel Classifier

**Files:**
- Create: `src/mindmodel/classifier.ts`
- Test: `tests/mindmodel/classifier.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/mindmodel/classifier.test.ts
import { describe, it, expect } from "bun:test";
import { buildClassifierPrompt, parseClassifierResponse } from "../../src/mindmodel/classifier";
import type { MindmodelManifest } from "../../src/mindmodel/types";

describe("mindmodel classifier", () => {
  const manifest: MindmodelManifest = {
    name: "test",
    version: 1,
    categories: [
      { path: "components/button.md", description: "Button component patterns" },
      { path: "components/form.md", description: "Form patterns with validation" },
      { path: "pages/settings.md", description: "Settings page layout" },
      { path: "patterns/data-fetching.md", description: "Data fetching with loading states" },
    ],
  };

  it("should build classifier prompt with manifest categories", () => {
    const prompt = buildClassifierPrompt("Add a settings page with a form", manifest);

    expect(prompt).toContain("Add a settings page with a form");
    expect(prompt).toContain("components/button.md");
    expect(prompt).toContain("Form patterns with validation");
    expect(prompt).toContain("JSON array");
  });

  it("should parse valid classifier response", () => {
    const response = '["components/form.md", "pages/settings.md"]';
    const result = parseClassifierResponse(response, manifest);

    expect(result).toEqual(["components/form.md", "pages/settings.md"]);
  });

  it("should filter out invalid paths from response", () => {
    const response = '["components/form.md", "invalid/path.md", "pages/settings.md"]';
    const result = parseClassifierResponse(response, manifest);

    expect(result).toEqual(["components/form.md", "pages/settings.md"]);
  });

  it("should return empty array for malformed response", () => {
    const response = "not valid json";
    const result = parseClassifierResponse(response, manifest);

    expect(result).toEqual([]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/whitemonk/projects/config/micode/.worktrees/mindmodel && bun test tests/mindmodel/classifier.test.ts`
Expected: FAIL with "Cannot find module"

**Step 3: Write minimal implementation**

```typescript
// src/mindmodel/classifier.ts
import type { MindmodelManifest } from "./types";

export function buildClassifierPrompt(task: string, manifest: MindmodelManifest): string {
  const categoriesText = manifest.categories
    .map((c) => `- ${c.path}: ${c.description}`)
    .join("\n");

  return `You are a task classifier. Given a coding task and a list of available example categories, determine which categories are relevant.

Task: "${task}"

Available categories:
${categoriesText}

Return ONLY a JSON array of relevant category paths. Example: ["components/form.md", "patterns/data-fetching.md"]

If no categories are relevant, return an empty array: []

Respond with ONLY the JSON array, no explanation.`;
}

export function parseClassifierResponse(response: string, manifest: MindmodelManifest): string[] {
  try {
    // Extract JSON array from response (handle markdown code blocks)
    const jsonMatch = response.match(/\[[\s\S]*?\]/);
    if (!jsonMatch) return [];

    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) return [];

    // Validate paths exist in manifest
    const validPaths = new Set(manifest.categories.map((c) => c.path));
    return parsed.filter((p): p is string => typeof p === "string" && validPaths.has(p));
  } catch {
    return [];
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/whitemonk/projects/config/micode/.worktrees/mindmodel && bun test tests/mindmodel/classifier.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
cd /Users/whitemonk/projects/config/micode/.worktrees/mindmodel && git add src/mindmodel/classifier.ts tests/mindmodel/classifier.test.ts && git commit -m "feat(mindmodel): add task classifier for category selection"
```

---

### Task 4: Mindmodel Formatter

**Files:**
- Create: `src/mindmodel/formatter.ts`
- Test: `tests/mindmodel/formatter.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/mindmodel/formatter.test.ts
import { describe, it, expect } from "bun:test";
import { formatExamplesForInjection } from "../../src/mindmodel/formatter";
import type { LoadedExample } from "../../src/mindmodel/loader";

describe("mindmodel formatter", () => {
  it("should format examples with XML tags", () => {
    const examples: LoadedExample[] = [
      {
        path: "components/button.md",
        description: "Button patterns",
        content: "# Button\n\n```tsx\n<Button>Click</Button>\n```",
      },
    ];

    const formatted = formatExamplesForInjection(examples);

    expect(formatted).toContain("<mindmodel-examples>");
    expect(formatted).toContain("</mindmodel-examples>");
    expect(formatted).toContain('category="components/button.md"');
    expect(formatted).toContain("Button patterns");
    expect(formatted).toContain("<Button>Click</Button>");
  });

  it("should format multiple examples", () => {
    const examples: LoadedExample[] = [
      { path: "a.md", description: "A", content: "Content A" },
      { path: "b.md", description: "B", content: "Content B" },
    ];

    const formatted = formatExamplesForInjection(examples);

    expect(formatted).toContain('category="a.md"');
    expect(formatted).toContain('category="b.md"');
    expect(formatted).toContain("Content A");
    expect(formatted).toContain("Content B");
  });

  it("should return empty string for empty examples", () => {
    const formatted = formatExamplesForInjection([]);
    expect(formatted).toBe("");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/whitemonk/projects/config/micode/.worktrees/mindmodel && bun test tests/mindmodel/formatter.test.ts`
Expected: FAIL with "Cannot find module"

**Step 3: Write minimal implementation**

```typescript
// src/mindmodel/formatter.ts
import type { LoadedExample } from "./loader";

export function formatExamplesForInjection(examples: LoadedExample[]): string {
  if (examples.length === 0) return "";

  const blocks = examples.map(
    (ex) => `<example category="${ex.path}" description="${ex.description}">
${ex.content}
</example>`
  );

  return `<mindmodel-examples>
These are code examples from this project's mindmodel. Follow these patterns when implementing similar functionality.

${blocks.join("\n\n")}
</mindmodel-examples>`;
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/whitemonk/projects/config/micode/.worktrees/mindmodel && bun test tests/mindmodel/formatter.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
cd /Users/whitemonk/projects/config/micode/.worktrees/mindmodel && git add src/mindmodel/formatter.ts tests/mindmodel/formatter.test.ts && git commit -m "feat(mindmodel): add formatter for context injection"
```

---

### Task 5: Mindmodel Index Export

**Files:**
- Create: `src/mindmodel/index.ts`

**Step 1: Write the failing test**

No separate test needed - this is just an index file exporting the module.

**Step 2: Skip (no test for index)**

**Step 3: Write minimal implementation**

```typescript
// src/mindmodel/index.ts
export { parseManifest, type MindmodelManifest, type Category } from "./types";
export { loadMindmodel, loadExamples, type LoadedMindmodel, type LoadedExample } from "./loader";
export { buildClassifierPrompt, parseClassifierResponse } from "./classifier";
export { formatExamplesForInjection } from "./formatter";
```

**Step 4: Verify by running all mindmodel tests**

Run: `cd /Users/whitemonk/projects/config/micode/.worktrees/mindmodel && bun test tests/mindmodel/`
Expected: All tests PASS

**Step 5: Commit**

```bash
cd /Users/whitemonk/projects/config/micode/.worktrees/mindmodel && git add src/mindmodel/index.ts && git commit -m "feat(mindmodel): add index export"
```

---

## Phase 2: Hook Integration

### Task 6: Mindmodel Injector Hook

**Files:**
- Create: `src/hooks/mindmodel-injector.ts`
- Test: `tests/hooks/mindmodel-injector.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/hooks/mindmodel-injector.test.ts
import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("mindmodel-injector hook", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "mindmodel-injector-test-"));
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  function createMockCtx(directory: string) {
    return {
      directory,
      client: {
        session: {},
        tui: {},
      },
    };
  }

  function setupMindmodel(dir: string) {
    const mindmodelDir = join(dir, ".mindmodel");
    mkdirSync(join(mindmodelDir, "components"), { recursive: true });

    writeFileSync(
      join(mindmodelDir, "manifest.yaml"),
      `
name: test-project
version: 1
categories:
  - path: components/button.md
    description: Button component patterns
  - path: components/form.md
    description: Form patterns
`
    );

    writeFileSync(
      join(mindmodelDir, "components/button.md"),
      "# Button\n\nUse this pattern for buttons.\n\n```tsx\n<Button>Click</Button>\n```"
    );
    writeFileSync(
      join(mindmodelDir, "components/form.md"),
      "# Form\n\nUse this pattern for forms.\n\n```tsx\n<Form onSubmit={...} />\n```"
    );
  }

  it("should not inject if no .mindmodel directory exists", async () => {
    const { createMindmodelInjectorHook } = await import("../../src/hooks/mindmodel-injector");

    const ctx = createMockCtx(testDir);
    const hook = createMindmodelInjectorHook(ctx as any, async () => "[]");

    const output = { system: "existing system prompt" };
    await hook["chat.params"]({ sessionID: "test" }, output);

    expect(output.system).toBe("existing system prompt");
  });

  it("should inject examples when classifier returns categories", async () => {
    setupMindmodel(testDir);

    const { createMindmodelInjectorHook } = await import("../../src/hooks/mindmodel-injector");

    const ctx = createMockCtx(testDir);
    // Mock classifier that returns form category
    const mockClassify = async () => '["components/form.md"]';
    const hook = createMindmodelInjectorHook(ctx as any, mockClassify);

    const output = { system: "existing prompt" };
    await hook["chat.params"](
      {
        sessionID: "test",
        messages: [{ role: "user", content: "Add a contact form" }],
      },
      output
    );

    expect(output.system).toContain("mindmodel-examples");
    expect(output.system).toContain("Form");
    expect(output.system).toContain("<Form onSubmit");
  });

  it("should not inject if classifier returns empty array", async () => {
    setupMindmodel(testDir);

    const { createMindmodelInjectorHook } = await import("../../src/hooks/mindmodel-injector");

    const ctx = createMockCtx(testDir);
    const mockClassify = async () => "[]";
    const hook = createMindmodelInjectorHook(ctx as any, mockClassify);

    const output = { system: "existing prompt" };
    await hook["chat.params"](
      {
        sessionID: "test",
        messages: [{ role: "user", content: "What time is it?" }],
      },
      output
    );

    expect(output.system).toBe("existing prompt");
    expect(output.system).not.toContain("mindmodel-examples");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/whitemonk/projects/config/micode/.worktrees/mindmodel && bun test tests/hooks/mindmodel-injector.test.ts`
Expected: FAIL with "Cannot find module"

**Step 3: Write minimal implementation**

```typescript
// src/hooks/mindmodel-injector.ts
import type { PluginInput } from "@opencode-ai/plugin";
import {
  loadMindmodel,
  loadExamples,
  buildClassifierPrompt,
  parseClassifierResponse,
  formatExamplesForInjection,
  type LoadedMindmodel,
} from "../mindmodel";

type ClassifyFn = (prompt: string) => Promise<string>;

interface ChatMessage {
  role: string;
  content: string | Array<{ type: string; text?: string }>;
}

function extractTaskFromMessages(messages: ChatMessage[]): string {
  // Get the last user message
  const lastUserMessage = [...messages].reverse().find((m) => m.role === "user");
  if (!lastUserMessage) return "";

  if (typeof lastUserMessage.content === "string") {
    return lastUserMessage.content;
  }

  // Handle array content (multimodal)
  return lastUserMessage.content
    .filter((p) => p.type === "text" && p.text)
    .map((p) => p.text)
    .join(" ");
}

export function createMindmodelInjectorHook(ctx: PluginInput, classifyFn: ClassifyFn) {
  let cachedMindmodel: LoadedMindmodel | null | undefined;

  async function getMindmodel(): Promise<LoadedMindmodel | null> {
    if (cachedMindmodel === undefined) {
      cachedMindmodel = await loadMindmodel(ctx.directory);
    }
    return cachedMindmodel;
  }

  return {
    "chat.params": async (
      input: { sessionID: string; messages?: ChatMessage[] },
      output: { system?: string }
    ) => {
      const mindmodel = await getMindmodel();
      if (!mindmodel) return;

      const messages = input.messages ?? [];
      const task = extractTaskFromMessages(messages);
      if (!task) return;

      // Classify the task
      const classifierPrompt = buildClassifierPrompt(task, mindmodel.manifest);
      const classifierResponse = await classifyFn(classifierPrompt);
      const categories = parseClassifierResponse(classifierResponse, mindmodel.manifest);

      if (categories.length === 0) return;

      // Load and format examples
      const examples = await loadExamples(mindmodel, categories);
      if (examples.length === 0) return;

      const formatted = formatExamplesForInjection(examples);

      // Inject into system prompt
      if (output.system) {
        output.system = formatted + "\n\n" + output.system;
      } else {
        output.system = formatted;
      }
    },
  };
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/whitemonk/projects/config/micode/.worktrees/mindmodel && bun test tests/hooks/mindmodel-injector.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
cd /Users/whitemonk/projects/config/micode/.worktrees/mindmodel && git add src/hooks/mindmodel-injector.ts tests/hooks/mindmodel-injector.test.ts && git commit -m "feat(mindmodel): add injector hook for context injection"
```

---

### Task 7: Integrate Hook into Plugin

**Files:**
- Modify: `src/index.ts`
- Test: Run full test suite

**Step 1: Write the failing test**

No separate test - verify via integration test running the full suite.

**Step 2: Skip**

**Step 3: Write minimal implementation**

Add to `src/index.ts` imports:

```typescript
import { createMindmodelInjectorHook } from "./hooks/mindmodel-injector";
```

Add after other hooks are created (around line 91):

```typescript
// Mindmodel injector hook
// Uses a simple inline classifier for now - can be upgraded to use LLM later
const mindmodelClassifyFn = async (prompt: string): Promise<string> => {
  // TODO: Integrate with actual LLM call via ctx.client
  // For now, return empty to disable until LLM integration is ready
  return "[]";
};
const mindmodelInjectorHook = createMindmodelInjectorHook(ctx, mindmodelClassifyFn);
```

Add to `chat.params` handler (around line 205):

```typescript
// Inject mindmodel examples (before other context)
await mindmodelInjectorHook["chat.params"](input, output);
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/whitemonk/projects/config/micode/.worktrees/mindmodel && bun test`
Expected: All 202+ tests PASS

**Step 5: Commit**

```bash
cd /Users/whitemonk/projects/config/micode/.worktrees/mindmodel && git add src/index.ts && git commit -m "feat(mindmodel): integrate injector hook into plugin"
```

---

## Phase 3: Generation Subagents

### Task 8: Stack Detector Agent

**Files:**
- Create: `src/agents/mindmodel/stack-detector.ts`
- Test: `tests/agents/mindmodel/stack-detector.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/agents/mindmodel/stack-detector.test.ts
import { describe, it, expect } from "bun:test";
import { stackDetectorAgent } from "../../../src/agents/mindmodel/stack-detector";

describe("stack-detector agent", () => {
  it("should be a subagent", () => {
    expect(stackDetectorAgent.mode).toBe("subagent");
  });

  it("should have a prompt that identifies tech stacks", () => {
    expect(stackDetectorAgent.prompt).toContain("tech stack");
    expect(stackDetectorAgent.prompt).toContain("Next.js");
    expect(stackDetectorAgent.prompt).toContain("Tailwind");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/whitemonk/projects/config/micode/.worktrees/mindmodel && bun test tests/agents/mindmodel/stack-detector.test.ts`
Expected: FAIL with "Cannot find module"

**Step 3: Write minimal implementation**

```typescript
// src/agents/mindmodel/stack-detector.ts
import type { AgentConfig } from "@opencode-ai/sdk";

const PROMPT = `<environment>
You are running as part of the "micode" OpenCode plugin.
You are a SUBAGENT for mindmodel generation - detecting project tech stack.
</environment>

<purpose>
Rapidly identify the tech stack of this project.
Output a structured analysis of frameworks, libraries, and tools.
</purpose>

<process>
1. Glob for config files: package.json, tsconfig.json, next.config.*, tailwind.config.*, etc.
2. Read relevant config files in parallel
3. Identify:
   - Language(s): TypeScript, JavaScript, Python, etc.
   - Framework(s): Next.js, React, Vue, Django, etc.
   - Styling: Tailwind, CSS Modules, Styled Components, etc.
   - Database: Prisma, Drizzle, SQLAlchemy, etc.
   - Testing: Jest, Vitest, Bun test, pytest, etc.
   - Build tools: Vite, Webpack, esbuild, etc.
</process>

<output-format>
Return a structured summary:

## Tech Stack

**Language:** [Primary language]
**Framework:** [Main framework]
**Styling:** [CSS approach]
**Database:** [ORM/database if any]
**Testing:** [Test framework]
**Build:** [Build tool]

**Key Dependencies:**
- [dep1]: [what it's for]
- [dep2]: [what it's for]

**Project Type:** [web app | API | CLI | library | monorepo]
</output-format>

<rules>
- Be fast - read config files, don't analyze source code
- Focus on what matters for mindmodel categories
- Note if it's a monorepo structure
</rules>`;

export const stackDetectorAgent: AgentConfig = {
  description: "Detects project tech stack for mindmodel generation",
  mode: "subagent",
  temperature: 0.2,
  prompt: PROMPT,
};
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/whitemonk/projects/config/micode/.worktrees/mindmodel && bun test tests/agents/mindmodel/stack-detector.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
cd /Users/whitemonk/projects/config/micode/.worktrees/mindmodel && git add src/agents/mindmodel/stack-detector.ts tests/agents/mindmodel/stack-detector.test.ts && git commit -m "feat(mindmodel): add stack-detector agent"
```

---

### Task 9: Pattern Discoverer Agent (for mindmodel)

**Files:**
- Create: `src/agents/mindmodel/pattern-discoverer.ts`
- Test: `tests/agents/mindmodel/pattern-discoverer.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/agents/mindmodel/pattern-discoverer.test.ts
import { describe, it, expect } from "bun:test";
import { mindmodelPatternDiscovererAgent } from "../../../src/agents/mindmodel/pattern-discoverer";

describe("mindmodel pattern-discoverer agent", () => {
  it("should be a subagent", () => {
    expect(mindmodelPatternDiscovererAgent.mode).toBe("subagent");
  });

  it("should have a prompt that discovers pattern categories", () => {
    expect(mindmodelPatternDiscovererAgent.prompt).toContain("categories");
    expect(mindmodelPatternDiscovererAgent.prompt).toContain("components");
    expect(mindmodelPatternDiscovererAgent.prompt).toContain("patterns");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/whitemonk/projects/config/micode/.worktrees/mindmodel && bun test tests/agents/mindmodel/pattern-discoverer.test.ts`
Expected: FAIL with "Cannot find module"

**Step 3: Write minimal implementation**

```typescript
// src/agents/mindmodel/pattern-discoverer.ts
import type { AgentConfig } from "@opencode-ai/sdk";

const PROMPT = `<environment>
You are running as part of the "micode" OpenCode plugin.
You are a SUBAGENT for mindmodel generation - discovering pattern categories.
</environment>

<purpose>
Analyze the codebase structure and identify categories of patterns that should be documented in the mindmodel.
</purpose>

<process>
1. Glob for directory structure
2. Identify repeating patterns:
   - Components (if React/Vue/etc.)
   - Pages/Routes
   - API endpoints
   - Hooks/Composables
   - Utilities
   - Services
   - Models/Types
   - Tests patterns
3. For each category, note:
   - Where files live (e.g., src/components/)
   - Naming convention (e.g., PascalCase.tsx)
   - How many instances exist
</process>

<output-format>
Return a list of discovered categories:

## Discovered Categories

### components
- **Location:** src/components/
- **Naming:** PascalCase.tsx
- **Count:** ~15 files
- **Examples:** Button.tsx, Modal.tsx, Form.tsx

### pages
- **Location:** src/app/ (App Router)
- **Naming:** page.tsx in directories
- **Count:** ~8 pages
- **Examples:** app/settings/page.tsx, app/dashboard/page.tsx

### patterns
- **Location:** various
- **Types identified:**
  - Data fetching (server components with loading states)
  - Form handling (react-hook-form + zod)
  - Authentication (middleware + context)

### api-routes
- **Location:** src/app/api/
- **Naming:** route.ts in directories
- **Count:** ~5 endpoints
</output-format>

<rules>
- Focus on patterns that recur (3+ instances)
- Prioritize user-facing code over utilities
- Note the tech-specific patterns (e.g., App Router vs Pages Router)
</rules>`;

export const mindmodelPatternDiscovererAgent: AgentConfig = {
  description: "Discovers pattern categories for mindmodel generation",
  mode: "subagent",
  temperature: 0.3,
  prompt: PROMPT,
};
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/whitemonk/projects/config/micode/.worktrees/mindmodel && bun test tests/agents/mindmodel/pattern-discoverer.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
cd /Users/whitemonk/projects/config/micode/.worktrees/mindmodel && git add src/agents/mindmodel/pattern-discoverer.ts tests/agents/mindmodel/pattern-discoverer.test.ts && git commit -m "feat(mindmodel): add pattern-discoverer agent"
```

---

### Task 10: Example Extractor Agent

**Files:**
- Create: `src/agents/mindmodel/example-extractor.ts`
- Test: `tests/agents/mindmodel/example-extractor.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/agents/mindmodel/example-extractor.test.ts
import { describe, it, expect } from "bun:test";
import { exampleExtractorAgent } from "../../../src/agents/mindmodel/example-extractor";

describe("example-extractor agent", () => {
  it("should be a subagent", () => {
    expect(exampleExtractorAgent.mode).toBe("subagent");
  });

  it("should have a prompt that extracts code examples", () => {
    expect(exampleExtractorAgent.prompt).toContain("extract");
    expect(exampleExtractorAgent.prompt).toContain("example");
    expect(exampleExtractorAgent.prompt).toContain("representative");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/whitemonk/projects/config/micode/.worktrees/mindmodel && bun test tests/agents/mindmodel/example-extractor.test.ts`
Expected: FAIL with "Cannot find module"

**Step 3: Write minimal implementation**

```typescript
// src/agents/mindmodel/example-extractor.ts
import type { AgentConfig } from "@opencode-ai/sdk";

const PROMPT = `<environment>
You are running as part of the "micode" OpenCode plugin.
You are a SUBAGENT for mindmodel generation - extracting code examples for ONE category.
</environment>

<purpose>
Extract 2-3 representative code examples for a single pattern category.
You receive: category name, location, file list.
You output: markdown with annotated code examples.
</purpose>

<selection-criteria>
Choose examples that are:
1. Representative - shows the common case, not edge cases
2. Complete - shows the full pattern, not a fragment
3. Medium complexity - not trivial, not overly complex
4. Well-structured - follows the project's conventions
5. Documented - preferably has existing comments

Avoid:
- The simplest instance (too trivial to learn from)
- The most complex instance (too specific)
- Files with unusual patterns or exceptions
- Auto-generated code
</selection-criteria>

<process>
1. Read the provided file list for this category
2. Skim 5-6 candidate files
3. Select 2-3 best examples based on criteria
4. Read selected files fully
5. Extract and annotate the code
</process>

<output-format>
Output markdown for this category file:

# [Category Name]

[1-2 sentence description of when to use this pattern]

## [Example 1 Name]

[When to use this specific variant]

\`\`\`tsx example
[Full code example]
\`\`\`

## [Example 2 Name]

[When to use this variant]

\`\`\`tsx example
[Full code example]
\`\`\`
</output-format>

<rules>
- Keep examples under 50 lines each when possible
- Remove imports that aren't essential to understand the pattern
- Add brief inline comments if the pattern isn't obvious
- Note any project-specific conventions
</rules>`;

export const exampleExtractorAgent: AgentConfig = {
  description: "Extracts code examples for one mindmodel category",
  mode: "subagent",
  temperature: 0.2,
  prompt: PROMPT,
};
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/whitemonk/projects/config/micode/.worktrees/mindmodel && bun test tests/agents/mindmodel/example-extractor.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
cd /Users/whitemonk/projects/config/micode/.worktrees/mindmodel && git add src/agents/mindmodel/example-extractor.ts tests/agents/mindmodel/example-extractor.test.ts && git commit -m "feat(mindmodel): add example-extractor agent"
```

---

### Task 11: Mindmodel Orchestrator Agent

**Files:**
- Create: `src/agents/mindmodel/orchestrator.ts`
- Test: `tests/agents/mindmodel/orchestrator.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/agents/mindmodel/orchestrator.test.ts
import { describe, it, expect } from "bun:test";
import { mindmodelOrchestratorAgent } from "../../../src/agents/mindmodel/orchestrator";

describe("mindmodel-orchestrator agent", () => {
  it("should be a subagent", () => {
    expect(mindmodelOrchestratorAgent.mode).toBe("subagent");
  });

  it("should reference spawn_agent for parallel execution", () => {
    expect(mindmodelOrchestratorAgent.prompt).toContain("spawn_agent");
    expect(mindmodelOrchestratorAgent.prompt).toContain("parallel");
  });

  it("should reference all mindmodel subagents", () => {
    expect(mindmodelOrchestratorAgent.prompt).toContain("stack-detector");
    expect(mindmodelOrchestratorAgent.prompt).toContain("pattern-discoverer");
    expect(mindmodelOrchestratorAgent.prompt).toContain("example-extractor");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/whitemonk/projects/config/micode/.worktrees/mindmodel && bun test tests/agents/mindmodel/orchestrator.test.ts`
Expected: FAIL with "Cannot find module"

**Step 3: Write minimal implementation**

```typescript
// src/agents/mindmodel/orchestrator.ts
import type { AgentConfig } from "@opencode-ai/sdk";

const PROMPT = `<environment>
You are running as part of the "micode" OpenCode plugin (NOT Claude Code).
You are a SUBAGENT - use spawn_agent tool (not Task tool) to spawn other subagents.
Available mindmodel agents: mm-stack-detector, mm-pattern-discoverer, mm-example-extractor.
</environment>

<purpose>
Orchestrate mindmodel generation through parallel subagent execution.
Generate .mindmodel/ directory with categorized code examples.
</purpose>

<critical-rule>
MAXIMIZE PARALLELISM. Speed is critical.
- Call multiple spawn_agent tools in ONE message for parallel execution
- Run multiple tool calls in single message
- Never wait for one thing when you can do many
</critical-rule>

<output>
Generate:
- .mindmodel/manifest.yaml
- .mindmodel/system.md
- .mindmodel/[category]/*.md files
</output>

<available-subagents>
<subagent name="mm-stack-detector">
  Identifies project tech stack (framework, styling, database, etc.)
  spawn_agent(agent="mm-stack-detector", prompt="Detect tech stack", description="Detect stack")
</subagent>

<subagent name="mm-pattern-discoverer">
  Discovers pattern categories in the codebase
  spawn_agent(agent="mm-pattern-discoverer", prompt="Discover patterns", description="Find patterns")
</subagent>

<subagent name="mm-example-extractor">
  Extracts examples for ONE category. Spawn multiple in parallel.
  spawn_agent(agent="mm-example-extractor", prompt="Extract examples for components from src/components/", description="Extract components")
</subagent>
</available-subagents>

<parallel-execution-strategy>
<phase name="1-discovery" description="Launch ALL discovery in ONE message">
  Call in a SINGLE message:
  - spawn_agent(agent="mm-stack-detector", ...)
  - spawn_agent(agent="mm-pattern-discoverer", ...)
  - Glob for existing .mindmodel/ (check if exists)
  - Glob for src/, app/, components/, etc. to understand structure
</phase>

<phase name="2-extraction" description="Extract examples in parallel">
  Based on discovered categories, in a SINGLE message spawn:
  - spawn_agent(agent="mm-example-extractor", prompt="Extract for components", ...)
  - spawn_agent(agent="mm-example-extractor", prompt="Extract for pages", ...)
  - spawn_agent(agent="mm-example-extractor", prompt="Extract for patterns", ...)
  - ... one per category
</phase>

<phase name="3-write" description="Write output files">
  - Write .mindmodel/manifest.yaml with all categories
  - Write .mindmodel/system.md with project overview
  - Write each category .md file from extractor outputs
</phase>
</parallel-execution-strategy>

<manifest-format>
name: [project-name]
version: 1
categories:
  - path: components/button.md
    description: Button component patterns
  - path: components/form.md
    description: Form patterns with validation
  - path: pages/settings.md
    description: Settings page layout
  - path: patterns/data-fetching.md
    description: Data fetching with loading states
</manifest-format>

<system-md-format>
# [Project Name] Mind Model

## Overview
[1-2 sentences about what this project is]

## Tech Stack
- **Framework:** [e.g., Next.js 15]
- **Styling:** [e.g., Tailwind CSS]
- **Database:** [e.g., Prisma + PostgreSQL]

## Key Conventions
- [Convention 1]
- [Convention 2]
- [Convention 3]

## When to Use Each Category
- **components/**: Reusable UI components
- **pages/**: Full page layouts
- **patterns/**: Cross-cutting patterns (data fetching, auth, etc.)
</system-md-format>

<rules>
- ALWAYS call multiple spawn_agent in a SINGLE message
- Write .mindmodel/ to project root
- Keep system.md under 100 lines
- Each category file should have 2-3 examples
</rules>`;

export const mindmodelOrchestratorAgent: AgentConfig = {
  description: "Orchestrates mindmodel generation with parallel subagents",
  mode: "subagent",
  temperature: 0.3,
  maxTokens: 32000,
  prompt: PROMPT,
};
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/whitemonk/projects/config/micode/.worktrees/mindmodel && bun test tests/agents/mindmodel/orchestrator.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
cd /Users/whitemonk/projects/config/micode/.worktrees/mindmodel && git add src/agents/mindmodel/orchestrator.ts tests/agents/mindmodel/orchestrator.test.ts && git commit -m "feat(mindmodel): add orchestrator agent"
```

---

### Task 12: Mindmodel Agents Index

**Files:**
- Create: `src/agents/mindmodel/index.ts`

**Step 1: Write the failing test**

No separate test - index file only.

**Step 2: Skip**

**Step 3: Write minimal implementation**

```typescript
// src/agents/mindmodel/index.ts
export { stackDetectorAgent } from "./stack-detector";
export { mindmodelPatternDiscovererAgent } from "./pattern-discoverer";
export { exampleExtractorAgent } from "./example-extractor";
export { mindmodelOrchestratorAgent } from "./orchestrator";
```

**Step 4: Verify by running all mindmodel agent tests**

Run: `cd /Users/whitemonk/projects/config/micode/.worktrees/mindmodel && bun test tests/agents/mindmodel/`
Expected: All tests PASS

**Step 5: Commit**

```bash
cd /Users/whitemonk/projects/config/micode/.worktrees/mindmodel && git add src/agents/mindmodel/index.ts && git commit -m "feat(mindmodel): add agents index"
```

---

### Task 13: Register Mindmodel Agents

**Files:**
- Modify: `src/agents/index.ts`

**Step 1: Write the failing test**

No separate test - verify via integration.

**Step 2: Skip**

**Step 3: Write minimal implementation**

Add imports at top of `src/agents/index.ts`:

```typescript
import {
  stackDetectorAgent,
  mindmodelPatternDiscovererAgent,
  exampleExtractorAgent,
  mindmodelOrchestratorAgent,
} from "./mindmodel";
```

Add to the `agents` record:

```typescript
// Mindmodel generation agents
"mm-stack-detector": { ...stackDetectorAgent, model: "openai/gpt-5.2-codex" },
"mm-pattern-discoverer": { ...mindmodelPatternDiscovererAgent, model: "openai/gpt-5.2-codex" },
"mm-example-extractor": { ...exampleExtractorAgent, model: "openai/gpt-5.2-codex" },
"mm-orchestrator": { ...mindmodelOrchestratorAgent, model: "openai/gpt-5.2-codex" },
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/whitemonk/projects/config/micode/.worktrees/mindmodel && bun test`
Expected: All tests PASS

**Step 5: Commit**

```bash
cd /Users/whitemonk/projects/config/micode/.worktrees/mindmodel && git add src/agents/index.ts && git commit -m "feat(mindmodel): register mindmodel agents"
```

---

## Phase 4: Command Integration

### Task 14: Add /mindmodel Command

**Files:**
- Modify: `src/index.ts`

**Step 1: Write the failing test**

No separate test - verify via integration.

**Step 2: Skip**

**Step 3: Write minimal implementation**

Add to the `config.command` section in `src/index.ts`:

```typescript
mindmodel: {
  description: "Generate .mindmodel/ with code examples from this project",
  agent: "mm-orchestrator",
  template: `Generate mindmodel for this project. $ARGUMENTS`,
},
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/whitemonk/projects/config/micode/.worktrees/mindmodel && bun test`
Expected: All tests PASS

**Step 5: Commit**

```bash
cd /Users/whitemonk/projects/config/micode/.worktrees/mindmodel && git add src/index.ts && git commit -m "feat(mindmodel): add /mindmodel command"
```

---

### Task 15: Update Config for Mindmodel Paths

**Files:**
- Modify: `src/utils/config.ts`

**Step 1: Write the failing test**

No separate test - config constants.

**Step 2: Skip**

**Step 3: Write minimal implementation**

Add to `config.paths`:

```typescript
/** Directory for mindmodel files */
mindmodelDir: ".mindmodel",
/** Mindmodel manifest filename */
mindmodelManifest: "manifest.yaml",
/** Mindmodel system file */
mindmodelSystem: "system.md",
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/whitemonk/projects/config/micode/.worktrees/mindmodel && bun test`
Expected: All tests PASS

**Step 5: Commit**

```bash
cd /Users/whitemonk/projects/config/micode/.worktrees/mindmodel && git add src/utils/config.ts && git commit -m "feat(mindmodel): add config paths"
```

---

## Phase 5: Final Integration

### Task 16: Update Context Injector for Mindmodel

**Files:**
- Modify: `src/hooks/context-injector.ts`

**Step 1: Write the failing test**

No separate test - the mindmodel injector is separate. This task updates context-injector to recognize .mindmodel/system.md as a root context file (always loaded).

**Step 2: Skip**

**Step 3: Write minimal implementation**

Update the `rootContextFiles` reference to also check for `.mindmodel/system.md`:

In `loadRootContextFiles()`, add after the existing loop:

```typescript
// Also load mindmodel system.md if it exists
try {
  const mindmodelSystem = join(ctx.directory, ".mindmodel", "system.md");
  const content = await readFile(mindmodelSystem, "utf-8");
  if (content.trim()) {
    cache.rootContent.set(".mindmodel/system.md", content);
  }
} catch {
  // Mindmodel doesn't exist - skip
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/whitemonk/projects/config/micode/.worktrees/mindmodel && bun test`
Expected: All tests PASS

**Step 5: Commit**

```bash
cd /Users/whitemonk/projects/config/micode/.worktrees/mindmodel && git add src/hooks/context-injector.ts && git commit -m "feat(mindmodel): load system.md as root context"
```

---

### Task 17: Full Integration Test

**Files:**
- Create: `tests/integration/mindmodel.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/integration/mindmodel.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("mindmodel integration", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "mindmodel-integration-test-"));
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("should load and format mindmodel examples", async () => {
    // Setup .mindmodel directory
    const mindmodelDir = join(testDir, ".mindmodel");
    mkdirSync(join(mindmodelDir, "components"), { recursive: true });

    writeFileSync(
      join(mindmodelDir, "manifest.yaml"),
      `
name: test-project
version: 1
categories:
  - path: components/button.md
    description: Button component patterns
`
    );

    writeFileSync(
      join(mindmodelDir, "components/button.md"),
      `# Button

Use this for all buttons.

\`\`\`tsx example
export function Button({ children }: { children: React.ReactNode }) {
  return <button className="btn">{children}</button>;
}
\`\`\`
`
    );

    // Test the full pipeline
    const { loadMindmodel, loadExamples, formatExamplesForInjection } = await import(
      "../../src/mindmodel"
    );

    const mindmodel = await loadMindmodel(testDir);
    expect(mindmodel).not.toBeNull();

    const examples = await loadExamples(mindmodel!, ["components/button.md"]);
    expect(examples).toHaveLength(1);

    const formatted = formatExamplesForInjection(examples);
    expect(formatted).toContain("mindmodel-examples");
    expect(formatted).toContain("Button component patterns");
    expect(formatted).toContain("className=");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/whitemonk/projects/config/micode/.worktrees/mindmodel && bun test tests/integration/mindmodel.test.ts`
Expected: Initially FAIL if modules not properly exported, then PASS

**Step 3: Fix any issues**

Ensure all exports are correct in `src/mindmodel/index.ts`.

**Step 4: Run test to verify it passes**

Run: `cd /Users/whitemonk/projects/config/micode/.worktrees/mindmodel && bun test tests/integration/mindmodel.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
cd /Users/whitemonk/projects/config/micode/.worktrees/mindmodel && git add tests/integration/mindmodel.test.ts && git commit -m "test(mindmodel): add integration test"
```

---

### Task 18: Final Test Suite Run

**Files:**
- None (verification only)

**Step 1: Run full test suite**

Run: `cd /Users/whitemonk/projects/config/micode/.worktrees/mindmodel && bun test`
Expected: All tests PASS (202+ original + ~15 new)

**Step 2: Run type check**

Run: `cd /Users/whitemonk/projects/config/micode/.worktrees/mindmodel && bun run typecheck`
Expected: No errors

**Step 3: Run linter**

Run: `cd /Users/whitemonk/projects/config/micode/.worktrees/mindmodel && bun run lint`
Expected: No errors

**Step 4: Final commit**

```bash
cd /Users/whitemonk/projects/config/micode/.worktrees/mindmodel && git add -A && git status
```

If any uncommitted changes, commit them with appropriate message.

---

## Summary

**Total Tasks:** 18

**New Files:**
- `src/mindmodel/types.ts`
- `src/mindmodel/loader.ts`
- `src/mindmodel/classifier.ts`
- `src/mindmodel/formatter.ts`
- `src/mindmodel/index.ts`
- `src/hooks/mindmodel-injector.ts`
- `src/agents/mindmodel/stack-detector.ts`
- `src/agents/mindmodel/pattern-discoverer.ts`
- `src/agents/mindmodel/example-extractor.ts`
- `src/agents/mindmodel/orchestrator.ts`
- `src/agents/mindmodel/index.ts`
- `tests/mindmodel/*.test.ts` (4 files)
- `tests/hooks/mindmodel-injector.test.ts`
- `tests/agents/mindmodel/*.test.ts` (4 files)
- `tests/integration/mindmodel.test.ts`

**Modified Files:**
- `src/index.ts` (hook registration + command)
- `src/agents/index.ts` (agent registration)
- `src/utils/config.ts` (paths)
- `src/hooks/context-injector.ts` (system.md loading)

**Dependencies:**
- `yaml` package (for parsing manifest.yaml) - add to package.json if not present
