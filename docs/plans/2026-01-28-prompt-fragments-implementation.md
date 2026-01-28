# Prompt Fragments Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow users to customize agent behavior by appending prompt fragments via external config.

**Architecture:** Two-layer config (global `micode.json` + project `.micode/fragments.json`), fragments concatenated and injected at beginning of agent system prompts via a new hook.

**Tech Stack:** TypeScript, Bun test runner, existing hook architecture

**Design:** See `docs/plans/2026-01-28-prompt-fragments-design.md`

---

## Task 1: Extend MicodeConfig interface for fragments

**Files:**
- Modify: `src/config-loader.ts:60-64` (MicodeConfig interface)
- Test: `tests/config-loader.test.ts`

**Step 1: Write the failing test**

Add to `tests/config-loader.test.ts`:

```typescript
describe("loadMicodeConfig - fragments", () => {
  let testConfigDir: string;

  beforeEach(() => {
    testConfigDir = join(tmpdir(), `micode-config-test-${Date.now()}`);
    mkdirSync(testConfigDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testConfigDir, { recursive: true, force: true });
  });

  it("should load fragments from micode.json", async () => {
    const configPath = join(testConfigDir, "micode.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        fragments: {
          brainstormer: ["Save discussions to multiple files"],
          planner: ["Always include test tasks"],
        },
      }),
    );

    const config = await loadMicodeConfig(testConfigDir);

    expect(config).not.toBeNull();
    expect(config?.fragments?.brainstormer).toEqual(["Save discussions to multiple files"]);
    expect(config?.fragments?.planner).toEqual(["Always include test tasks"]);
  });

  it("should handle empty fragments object", async () => {
    const configPath = join(testConfigDir, "micode.json");
    writeFileSync(configPath, JSON.stringify({ fragments: {} }));

    const config = await loadMicodeConfig(testConfigDir);

    expect(config?.fragments).toEqual({});
  });

  it("should filter out non-string values in fragment arrays", async () => {
    const configPath = join(testConfigDir, "micode.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        fragments: {
          brainstormer: ["valid string", 123, null, "another valid"],
        },
      }),
    );

    const config = await loadMicodeConfig(testConfigDir);

    expect(config?.fragments?.brainstormer).toEqual(["valid string", "another valid"]);
  });

  it("should filter out empty strings from fragments", async () => {
    const configPath = join(testConfigDir, "micode.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        fragments: {
          brainstormer: ["valid", "", "  ", "also valid"],
        },
      }),
    );

    const config = await loadMicodeConfig(testConfigDir);

    expect(config?.fragments?.brainstormer).toEqual(["valid", "also valid"]);
  });

  it("should skip non-array fragment values", async () => {
    const configPath = join(testConfigDir, "micode.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        fragments: {
          brainstormer: ["valid array"],
          planner: "not an array",
          implementer: { not: "array" },
        },
      }),
    );

    const config = await loadMicodeConfig(testConfigDir);

    expect(config?.fragments?.brainstormer).toEqual(["valid array"]);
    expect(config?.fragments?.planner).toBeUndefined();
    expect(config?.fragments?.implementer).toBeUndefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/config-loader.test.ts -t "fragments"`
Expected: FAIL - `fragments` property doesn't exist on MicodeConfig

**Step 3: Write minimal implementation**

In `src/config-loader.ts`, update the `MicodeConfig` interface (around line 60):

```typescript
export interface MicodeConfig {
  agents?: Record<string, AgentOverride>;
  features?: MicodeFeatures;
  compactionThreshold?: number;
  fragments?: Record<string, string[]>;
}
```

Then add parsing logic in `loadMicodeConfig` function after the compactionThreshold block (around line 117):

```typescript
    // Parse fragments
    if (parsed.fragments && typeof parsed.fragments === "object") {
      const fragments = parsed.fragments as Record<string, unknown>;
      const sanitizedFragments: Record<string, string[]> = {};

      for (const [agentName, fragmentList] of Object.entries(fragments)) {
        if (Array.isArray(fragmentList)) {
          const validFragments = fragmentList
            .filter((f): f is string => typeof f === "string" && f.trim().length > 0);
          if (validFragments.length > 0) {
            sanitizedFragments[agentName] = validFragments;
          }
        }
      }

      if (Object.keys(sanitizedFragments).length > 0) {
        result.fragments = sanitizedFragments;
      }
    }
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/config-loader.test.ts -t "fragments"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/config-loader.ts tests/config-loader.test.ts
git commit -m "feat(config): add fragments support to MicodeConfig"
```

---

## Task 2: Create fragment-injector hook - load project fragments

**Files:**
- Create: `src/hooks/fragment-injector.ts`
- Test: `tests/hooks/fragment-injector.test.ts`

**Step 1: Write the failing test**

Create `tests/hooks/fragment-injector.test.ts`:

```typescript
// tests/hooks/fragment-injector.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function createMockCtx(directory: string) {
  return {
    directory,
    client: {
      session: {},
      tui: {},
    },
  };
}

describe("fragment-injector", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "fragment-injector-test-"));
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("loadProjectFragments", () => {
    it("should load fragments from .micode/fragments.json", async () => {
      // Create .micode directory and fragments.json
      const micodeDir = join(testDir, ".micode");
      mkdirSync(micodeDir, { recursive: true });
      writeFileSync(
        join(micodeDir, "fragments.json"),
        JSON.stringify({
          brainstormer: ["Project-specific instruction"],
          implementer: ["Run tests after changes"],
        }),
      );

      const { loadProjectFragments } = await import("../../src/hooks/fragment-injector");
      const fragments = await loadProjectFragments(testDir);

      expect(fragments.brainstormer).toEqual(["Project-specific instruction"]);
      expect(fragments.implementer).toEqual(["Run tests after changes"]);
    });

    it("should return empty object when .micode/fragments.json does not exist", async () => {
      const { loadProjectFragments } = await import("../../src/hooks/fragment-injector");
      const fragments = await loadProjectFragments(testDir);

      expect(fragments).toEqual({});
    });

    it("should return empty object for invalid JSON", async () => {
      const micodeDir = join(testDir, ".micode");
      mkdirSync(micodeDir, { recursive: true });
      writeFileSync(join(micodeDir, "fragments.json"), "{ invalid json }");

      const { loadProjectFragments } = await import("../../src/hooks/fragment-injector");
      const fragments = await loadProjectFragments(testDir);

      expect(fragments).toEqual({});
    });

    it("should filter invalid entries same as global config", async () => {
      const micodeDir = join(testDir, ".micode");
      mkdirSync(micodeDir, { recursive: true });
      writeFileSync(
        join(micodeDir, "fragments.json"),
        JSON.stringify({
          brainstormer: ["valid", "", 123],
          planner: "not-an-array",
        }),
      );

      const { loadProjectFragments } = await import("../../src/hooks/fragment-injector");
      const fragments = await loadProjectFragments(testDir);

      expect(fragments.brainstormer).toEqual(["valid"]);
      expect(fragments.planner).toBeUndefined();
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/hooks/fragment-injector.test.ts`
Expected: FAIL - module doesn't exist

**Step 3: Write minimal implementation**

Create `src/hooks/fragment-injector.ts`:

```typescript
// src/hooks/fragment-injector.ts
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Load project-level fragments from .micode/fragments.json
 * Returns empty object if file doesn't exist or is invalid
 */
export async function loadProjectFragments(projectDir: string): Promise<Record<string, string[]>> {
  const fragmentsPath = join(projectDir, ".micode", "fragments.json");

  try {
    const content = await readFile(fragmentsPath, "utf-8");
    const parsed = JSON.parse(content) as Record<string, unknown>;

    const fragments: Record<string, string[]> = {};

    for (const [agentName, fragmentList] of Object.entries(parsed)) {
      if (Array.isArray(fragmentList)) {
        const validFragments = fragmentList.filter(
          (f): f is string => typeof f === "string" && f.trim().length > 0,
        );
        if (validFragments.length > 0) {
          fragments[agentName] = validFragments;
        }
      }
    }

    return fragments;
  } catch {
    return {};
  }
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/hooks/fragment-injector.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/hooks/fragment-injector.ts tests/hooks/fragment-injector.test.ts
git commit -m "feat(hooks): add loadProjectFragments function"
```

---

## Task 3: Add fragment merging logic

**Files:**
- Modify: `src/hooks/fragment-injector.ts`
- Test: `tests/hooks/fragment-injector.test.ts`

**Step 1: Write the failing test**

Add to `tests/hooks/fragment-injector.test.ts`:

```typescript
describe("mergeFragments", () => {
  it("should concatenate global and project fragments", async () => {
    const { mergeFragments } = await import("../../src/hooks/fragment-injector");

    const global = {
      brainstormer: ["global instruction 1", "global instruction 2"],
      planner: ["global planner instruction"],
    };
    const project = {
      brainstormer: ["project instruction"],
      implementer: ["project implementer instruction"],
    };

    const merged = mergeFragments(global, project);

    expect(merged.brainstormer).toEqual([
      "global instruction 1",
      "global instruction 2",
      "project instruction",
    ]);
    expect(merged.planner).toEqual(["global planner instruction"]);
    expect(merged.implementer).toEqual(["project implementer instruction"]);
  });

  it("should return global only when project is empty", async () => {
    const { mergeFragments } = await import("../../src/hooks/fragment-injector");

    const global = { brainstormer: ["global instruction"] };
    const project = {};

    const merged = mergeFragments(global, project);

    expect(merged.brainstormer).toEqual(["global instruction"]);
  });

  it("should return project only when global is empty", async () => {
    const { mergeFragments } = await import("../../src/hooks/fragment-injector");

    const global = {};
    const project = { brainstormer: ["project instruction"] };

    const merged = mergeFragments(global, project);

    expect(merged.brainstormer).toEqual(["project instruction"]);
  });

  it("should return empty object when both are empty", async () => {
    const { mergeFragments } = await import("../../src/hooks/fragment-injector");

    const merged = mergeFragments({}, {});

    expect(merged).toEqual({});
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/hooks/fragment-injector.test.ts -t "mergeFragments"`
Expected: FAIL - function doesn't exist

**Step 3: Write minimal implementation**

Add to `src/hooks/fragment-injector.ts`:

```typescript
/**
 * Merge global and project fragments
 * Global fragments come first, project fragments are appended
 */
export function mergeFragments(
  global: Record<string, string[]>,
  project: Record<string, string[]>,
): Record<string, string[]> {
  const allAgents = new Set([...Object.keys(global), ...Object.keys(project)]);
  const merged: Record<string, string[]> = {};

  for (const agent of allAgents) {
    const globalFragments = global[agent] ?? [];
    const projectFragments = project[agent] ?? [];
    const combined = [...globalFragments, ...projectFragments];

    if (combined.length > 0) {
      merged[agent] = combined;
    }
  }

  return merged;
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/hooks/fragment-injector.test.ts -t "mergeFragments"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/hooks/fragment-injector.ts tests/hooks/fragment-injector.test.ts
git commit -m "feat(hooks): add mergeFragments function"
```

---

## Task 4: Add fragment formatting logic

**Files:**
- Modify: `src/hooks/fragment-injector.ts`
- Test: `tests/hooks/fragment-injector.test.ts`

**Step 1: Write the failing test**

Add to `tests/hooks/fragment-injector.test.ts`:

```typescript
describe("formatFragmentsBlock", () => {
  it("should format fragments as XML block with bullets", async () => {
    const { formatFragmentsBlock } = await import("../../src/hooks/fragment-injector");

    const fragments = ["Instruction one", "Instruction two"];
    const result = formatFragmentsBlock(fragments);

    expect(result).toBe(
      `<user-instructions>\n- Instruction one\n- Instruction two\n</user-instructions>\n\n`,
    );
  });

  it("should return empty string for empty array", async () => {
    const { formatFragmentsBlock } = await import("../../src/hooks/fragment-injector");

    const result = formatFragmentsBlock([]);

    expect(result).toBe("");
  });

  it("should handle single fragment", async () => {
    const { formatFragmentsBlock } = await import("../../src/hooks/fragment-injector");

    const result = formatFragmentsBlock(["Single instruction"]);

    expect(result).toBe(`<user-instructions>\n- Single instruction\n</user-instructions>\n\n`);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/hooks/fragment-injector.test.ts -t "formatFragmentsBlock"`
Expected: FAIL - function doesn't exist

**Step 3: Write minimal implementation**

Add to `src/hooks/fragment-injector.ts`:

```typescript
/**
 * Format fragments as an XML block for injection into system prompt
 */
export function formatFragmentsBlock(fragments: string[]): string {
  if (fragments.length === 0) {
    return "";
  }

  const bullets = fragments.map((f) => `- ${f}`).join("\n");
  return `<user-instructions>\n${bullets}\n</user-instructions>\n\n`;
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/hooks/fragment-injector.test.ts -t "formatFragmentsBlock"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/hooks/fragment-injector.ts tests/hooks/fragment-injector.test.ts
git commit -m "feat(hooks): add formatFragmentsBlock function"
```

---

## Task 5: Create the hook factory function

**Files:**
- Modify: `src/hooks/fragment-injector.ts`
- Test: `tests/hooks/fragment-injector.test.ts`

**Step 1: Write the failing test**

Add to `tests/hooks/fragment-injector.test.ts`:

```typescript
describe("createFragmentInjectorHook", () => {
  it("should inject fragments at beginning of system prompt", async () => {
    // Create project fragments
    const micodeDir = join(testDir, ".micode");
    mkdirSync(micodeDir, { recursive: true });
    writeFileSync(
      join(micodeDir, "fragments.json"),
      JSON.stringify({
        brainstormer: ["Project instruction"],
      }),
    );

    const { createFragmentInjectorHook } = await import("../../src/hooks/fragment-injector");
    const ctx = createMockCtx(testDir);
    const globalConfig = {
      fragments: {
        brainstormer: ["Global instruction"],
      },
    };

    const hooks = createFragmentInjectorHook(ctx as any, globalConfig);

    const input = { sessionID: "test-session" };
    const output = {
      system: "Original system prompt",
      options: { agent: "brainstormer" },
    };

    await hooks["chat.params"](input, output);

    expect(output.system).toContain("<user-instructions>");
    expect(output.system).toContain("- Global instruction");
    expect(output.system).toContain("- Project instruction");
    // Should be at the beginning
    expect(output.system.startsWith("<user-instructions>")).toBe(true);
    // Original content should be preserved after
    expect(output.system).toContain("Original system prompt");
  });

  it("should not inject when agent has no fragments", async () => {
    const { createFragmentInjectorHook } = await import("../../src/hooks/fragment-injector");
    const ctx = createMockCtx(testDir);
    const globalConfig = {
      fragments: {
        planner: ["Planner instruction"],
      },
    };

    const hooks = createFragmentInjectorHook(ctx as any, globalConfig);

    const input = { sessionID: "test-session" };
    const output = {
      system: "Original system prompt",
      options: { agent: "brainstormer" },
    };

    await hooks["chat.params"](input, output);

    expect(output.system).toBe("Original system prompt");
    expect(output.system).not.toContain("<user-instructions>");
  });

  it("should handle no global config", async () => {
    const micodeDir = join(testDir, ".micode");
    mkdirSync(micodeDir, { recursive: true });
    writeFileSync(
      join(micodeDir, "fragments.json"),
      JSON.stringify({
        brainstormer: ["Project only instruction"],
      }),
    );

    const { createFragmentInjectorHook } = await import("../../src/hooks/fragment-injector");
    const ctx = createMockCtx(testDir);

    const hooks = createFragmentInjectorHook(ctx as any, null);

    const input = { sessionID: "test-session" };
    const output = {
      system: "Original prompt",
      options: { agent: "brainstormer" },
    };

    await hooks["chat.params"](input, output);

    expect(output.system).toContain("Project only instruction");
  });

  it("should handle missing agent in options", async () => {
    const { createFragmentInjectorHook } = await import("../../src/hooks/fragment-injector");
    const ctx = createMockCtx(testDir);
    const globalConfig = {
      fragments: {
        brainstormer: ["Some instruction"],
      },
    };

    const hooks = createFragmentInjectorHook(ctx as any, globalConfig);

    const input = { sessionID: "test-session" };
    const output = {
      system: "Original prompt",
      options: {},
    };

    await hooks["chat.params"](input, output);

    // Should not crash, system unchanged
    expect(output.system).toBe("Original prompt");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/hooks/fragment-injector.test.ts -t "createFragmentInjectorHook"`
Expected: FAIL - function doesn't exist

**Step 3: Write minimal implementation**

Add to `src/hooks/fragment-injector.ts`:

```typescript
import type { PluginInput } from "@opencode-ai/plugin";

import type { MicodeConfig } from "../config-loader";

/**
 * Create fragment injector hook
 * Injects user-defined fragments at the beginning of agent system prompts
 */
export function createFragmentInjectorHook(ctx: PluginInput, globalConfig: MicodeConfig | null) {
  // Cache for project fragments (loaded once per session)
  let projectFragmentsCache: Record<string, string[]> | null = null;

  async function getProjectFragments(): Promise<Record<string, string[]>> {
    if (projectFragmentsCache === null) {
      projectFragmentsCache = await loadProjectFragments(ctx.directory);
    }
    return projectFragmentsCache;
  }

  return {
    "chat.params": async (
      _input: { sessionID: string },
      output: { options?: Record<string, unknown>; system?: string },
    ) => {
      const agent = output.options?.agent as string | undefined;
      if (!agent) return;

      const globalFragments = globalConfig?.fragments ?? {};
      const projectFragments = await getProjectFragments();
      const mergedFragments = mergeFragments(globalFragments, projectFragments);

      const agentFragments = mergedFragments[agent];
      if (!agentFragments || agentFragments.length === 0) return;

      const fragmentBlock = formatFragmentsBlock(agentFragments);

      if (output.system) {
        output.system = fragmentBlock + output.system;
      } else {
        output.system = fragmentBlock;
      }
    },
  };
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/hooks/fragment-injector.test.ts -t "createFragmentInjectorHook"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/hooks/fragment-injector.ts tests/hooks/fragment-injector.test.ts
git commit -m "feat(hooks): add createFragmentInjectorHook factory"
```

---

## Task 6: Add unknown agent warning with typo suggestion

**Files:**
- Modify: `src/hooks/fragment-injector.ts`
- Test: `tests/hooks/fragment-injector.test.ts`

**Step 1: Write the failing test**

Add to `tests/hooks/fragment-injector.test.ts`:

```typescript
describe("warnUnknownAgents", () => {
  it("should return warning message for unknown agent names", async () => {
    const { warnUnknownAgents } = await import("../../src/hooks/fragment-injector");

    const knownAgents = new Set(["brainstormer", "planner", "implementer"]);
    const fragmentAgents = ["brainstormer", "brianstormer", "unknown-agent"];

    const warnings = warnUnknownAgents(fragmentAgents, knownAgents);

    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain("brianstormer");
    expect(warnings[0]).toContain('Did you mean "brainstormer"?');
    expect(warnings[1]).toContain("unknown-agent");
  });

  it("should not warn for known agents", async () => {
    const { warnUnknownAgents } = await import("../../src/hooks/fragment-injector");

    const knownAgents = new Set(["brainstormer", "planner"]);
    const fragmentAgents = ["brainstormer", "planner"];

    const warnings = warnUnknownAgents(fragmentAgents, knownAgents);

    expect(warnings).toHaveLength(0);
  });

  it("should suggest closest match for typos", async () => {
    const { warnUnknownAgents } = await import("../../src/hooks/fragment-injector");

    const knownAgents = new Set(["brainstormer", "planner", "implementer", "reviewer"]);
    const fragmentAgents = ["planr", "implmenter"];

    const warnings = warnUnknownAgents(fragmentAgents, knownAgents);

    expect(warnings[0]).toContain('Did you mean "planner"?');
    expect(warnings[1]).toContain('Did you mean "implementer"?');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/hooks/fragment-injector.test.ts -t "warnUnknownAgents"`
Expected: FAIL - function doesn't exist

**Step 3: Write minimal implementation**

Add to `src/hooks/fragment-injector.ts`:

```typescript
/**
 * Simple Levenshtein distance for typo detection
 */
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1, // insertion
          matrix[i - 1][j] + 1, // deletion
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Find closest matching agent name
 */
function findClosestAgent(unknown: string, knownAgents: Set<string>): string | null {
  let closest: string | null = null;
  let minDistance = Infinity;

  for (const known of knownAgents) {
    const distance = levenshteinDistance(unknown, known);
    // Only suggest if distance is reasonable (less than half the length)
    if (distance < minDistance && distance <= Math.ceil(known.length / 2)) {
      minDistance = distance;
      closest = known;
    }
  }

  return closest;
}

/**
 * Generate warnings for unknown agent names in fragments config
 */
export function warnUnknownAgents(fragmentAgents: string[], knownAgents: Set<string>): string[] {
  const warnings: string[] = [];

  for (const agent of fragmentAgents) {
    if (!knownAgents.has(agent)) {
      const closest = findClosestAgent(agent, knownAgents);
      if (closest) {
        warnings.push(`[micode] Unknown agent "${agent}" in fragments config. Did you mean "${closest}"?`);
      } else {
        warnings.push(`[micode] Unknown agent "${agent}" in fragments config.`);
      }
    }
  }

  return warnings;
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/hooks/fragment-injector.test.ts -t "warnUnknownAgents"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/hooks/fragment-injector.ts tests/hooks/fragment-injector.test.ts
git commit -m "feat(hooks): add unknown agent warning with typo suggestions"
```

---

## Task 7: Register fragment-injector hook in plugin

**Files:**
- Modify: `src/index.ts`
- Test: `tests/index.test.ts` (if exists, or manual verification)

**Step 1: Understand the registration pattern**

Looking at `src/index.ts:95-101`, hooks are created like:
```typescript
const contextInjectorHook = createContextInjectorHook(ctx);
```

And used in `chat.params` handler at line 283-302.

**Step 2: Add import**

At the top of `src/index.ts`, add:

```typescript
import { createFragmentInjectorHook } from "./hooks/fragment-injector";
```

**Step 3: Create hook instance**

After line 101 (after `fileOpsTrackerHook`), add:

```typescript
  // Fragment injector hook - injects user-defined prompt fragments
  const fragmentInjectorHook = createFragmentInjectorHook(ctx, userConfig);
```

**Step 4: Register in chat.params handler**

In the `"chat.params"` handler (around line 283), add at the **beginning** (before other injections since fragments go first):

```typescript
    "chat.params": async (input, output) => {
      // Inject user-defined fragments FIRST (highest priority, beginning of prompt)
      await fragmentInjectorHook["chat.params"](input, output);

      // Inject ledger context (high priority)
      await ledgerLoaderHook["chat.params"](input, output);
      // ... rest unchanged
```

**Step 5: Test manually**

Create a test config:
```bash
mkdir -p ~/.config/opencode
echo '{"fragments": {"brainstormer": ["Test instruction from config"]}}' > ~/.config/opencode/micode.json
```

Start opencode and verify the brainstormer agent receives the fragment.

**Step 6: Commit**

```bash
git add src/index.ts
git commit -m "feat(plugin): register fragment-injector hook"
```

---

## Task 8: Add agent validation on startup

**Files:**
- Modify: `src/index.ts`
- Modify: `src/hooks/fragment-injector.ts`

**Step 1: Export agent names from agents/index.ts**

The agent names are already available as keys in the `agents` object. We can use `Object.keys(agents)`.

**Step 2: Call warnUnknownAgents on startup**

In `src/index.ts`, after creating the fragment hook, add validation:

```typescript
  // Fragment injector hook - injects user-defined prompt fragments
  const fragmentInjectorHook = createFragmentInjectorHook(ctx, userConfig);

  // Warn about unknown agent names in fragments config
  if (userConfig?.fragments) {
    const { warnUnknownAgents } = await import("./hooks/fragment-injector");
    const knownAgentNames = new Set(Object.keys(agents));
    const fragmentAgentNames = Object.keys(userConfig.fragments);
    const warnings = warnUnknownAgents(fragmentAgentNames, knownAgentNames);
    for (const warning of warnings) {
      console.warn(warning);
    }
  }
```

**Step 3: Test manually**

Add a typo to config:
```bash
echo '{"fragments": {"brianstormer": ["Test"]}}' > ~/.config/opencode/micode.json
```

Start opencode and verify warning appears:
```
[micode] Unknown agent "brianstormer" in fragments config. Did you mean "brainstormer"?
```

**Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat(plugin): validate fragment agent names on startup"
```

---

## Task 9: Update design doc with implementation notes

**Files:**
- Modify: `docs/plans/2026-01-28-prompt-fragments-design.md`

**Step 1: Add implementation status**

Add at the end of the design doc:

```markdown
## Implementation Status

Implemented in commits:
- `feat(config): add fragments support to MicodeConfig`
- `feat(hooks): add loadProjectFragments function`
- `feat(hooks): add mergeFragments function`
- `feat(hooks): add formatFragmentsBlock function`
- `feat(hooks): add createFragmentInjectorHook factory`
- `feat(hooks): add unknown agent warning with typo suggestions`
- `feat(plugin): register fragment-injector hook`
- `feat(plugin): validate fragment agent names on startup`

### Files Created/Modified

- `src/config-loader.ts` - Extended MicodeConfig interface
- `src/hooks/fragment-injector.ts` - New hook for fragment injection
- `src/index.ts` - Registered hook and startup validation
- `tests/config-loader.test.ts` - Fragment loading tests
- `tests/hooks/fragment-injector.test.ts` - Hook unit tests
```

**Step 2: Commit**

```bash
git add docs/plans/2026-01-28-prompt-fragments-design.md
git commit -m "docs: update design with implementation status"
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Extend MicodeConfig for fragments | config-loader.ts |
| 2 | Create loadProjectFragments | fragment-injector.ts |
| 3 | Add mergeFragments | fragment-injector.ts |
| 4 | Add formatFragmentsBlock | fragment-injector.ts |
| 5 | Create hook factory | fragment-injector.ts |
| 6 | Add unknown agent warnings | fragment-injector.ts |
| 7 | Register hook in plugin | index.ts |
| 8 | Add startup validation | index.ts |
| 9 | Update design doc | design.md |

Total: 9 tasks, ~45 steps
