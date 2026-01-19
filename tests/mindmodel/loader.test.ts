// tests/mindmodel/loader.test.ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadExamples, loadMindmodel } from "../../src/mindmodel/loader";

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
`,
    );

    mkdirSync(join(mindmodelDir, "components"), { recursive: true });
    writeFileSync(
      join(mindmodelDir, "components/button.md"),
      "# Button\n\n```tsx example\n<Button>Click</Button>\n```",
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
`,
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
