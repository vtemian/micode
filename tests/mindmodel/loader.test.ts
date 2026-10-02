// tests/mindmodel/loader.test.ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadExamples, loadMindmodel } from "../../src/mindmodel/loader";
import { captureLogs, type LogCapture } from "../helpers/log-capture";

describe("mindmodel loader", () => {
  let testDir: string;
  let logs: LogCapture;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "mindmodel-loader-test-"));
    logs = captureLogs();
  });

  afterEach(() => {
    // Only `warn` is asserted on throughout; `info` and `error` are read here so
    // the derivation notice counts as inspected rather than as stray output.
    void logs.info;
    void logs.error;
    const stray = logs.unread();
    logs.restore();
    expect(stray).toEqual([]);
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
    expect(mindmodel?.manifest.name).toBe("test-project");
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

  it("should return null when manifest has invalid content", async () => {
    const mindmodelDir = join(testDir, ".mindmodel");
    mkdirSync(mindmodelDir, { recursive: true });

    writeFileSync(
      join(mindmodelDir, "manifest.yaml"),
      `
name: test
categories: []
`,
    );

    const mindmodel = await loadMindmodel(testDir);
    expect(mindmodel).toBeNull();
    expect(logs.warn).toEqual([
      '[mindmodel] Failed to load manifest: Invalid key: Expected "version" but received undefined',
    ]);
  });

  it("should skip gracefully when loading examples with non-existent category path", async () => {
    const mindmodelDir = join(testDir, ".mindmodel");
    mkdirSync(join(mindmodelDir, "components"), { recursive: true });

    writeFileSync(
      join(mindmodelDir, "manifest.yaml"),
      `
name: test
version: 1
categories:
  - path: components/button.md
    description: Button patterns
  - path: components/missing.md
    description: Missing file
`,
    );

    writeFileSync(join(mindmodelDir, "components/button.md"), "# Button\nButton content");
    // Note: components/missing.md is intentionally not created

    const mindmodel = await loadMindmodel(testDir);
    const examples = await loadExamples(mindmodel!, ["components/button.md", "components/missing.md"]);

    // Should only return the existing file, skipping the missing one
    expect(examples).toHaveLength(1);
    expect(examples[0].path).toBe("components/button.md");
    expect(logs.warn).toEqual(["[mindmodel] Failed to load example: components/missing.md"]);
  });

  it("names the constraint files that are not markdown", async () => {
    const mindmodelDir = join(testDir, ".mindmodel");
    mkdirSync(join(mindmodelDir, "stack"), { recursive: true });

    writeFileSync(
      join(mindmodelDir, "manifest.yaml"),
      `
name: test
version: 1
categories:
  - path: stack/frontend.yaml
    description: Frontend patterns
  - path: stack/backend.md
    description: Backend patterns
  - path: patterns/logging.yml
    description: Logging patterns
`,
    );

    const mindmodel = await loadMindmodel(testDir);

    // A wrong extension is worth reporting but must not discard the manifest.
    expect(mindmodel).not.toBeNull();
    expect(mindmodel?.manifest.categories).toHaveLength(3);
    expect(logs.warn).toEqual([
      "[mindmodel] Constraint files must end in .md: stack/frontend.yaml, patterns/logging.yml",
    ]);
  });

  it("stays quiet when every constraint file is markdown", async () => {
    const mindmodelDir = join(testDir, ".mindmodel");
    mkdirSync(join(mindmodelDir, "stack"), { recursive: true });

    writeFileSync(
      join(mindmodelDir, "manifest.yaml"),
      `
name: test
version: 1
categories:
  - path: stack/frontend.md
    description: Frontend patterns
`,
    );

    expect(await loadMindmodel(testDir)).not.toBeNull();
    expect(logs.warn).toEqual([]);
  });

  // A hand-written .mindmodel/ is a flat set of markdown files and no manifest.
  // It used to load as null, and the tool reported that as "No .mindmodel/
  // directory found" — so the model was told to proceed without constraints
  // while the constraints sat unread. The files are the content; ignoring them
  // is the bug, not their absence of a manifest.

  it("derives categories from a .mindmodel that has no manifest", async () => {
    const mindmodelDir = join(testDir, ".mindmodel");
    mkdirSync(mindmodelDir, { recursive: true });

    writeFileSync(join(mindmodelDir, "constraints.md"), "# Architecture Constraints\n\nFive hard rules.\n");
    writeFileSync(join(mindmodelDir, "patterns.md"), "# Patterns & Conventions\n\nParser subclass pattern.\n");

    const mindmodel = await loadMindmodel(testDir);

    expect(mindmodel).not.toBeNull();
    expect(mindmodel?.manifest.categories.map((c) => c.path)).toEqual(["constraints.md", "patterns.md"]);
  });

  it("takes each description from the file's H1", async () => {
    const mindmodelDir = join(testDir, ".mindmodel");
    mkdirSync(mindmodelDir, { recursive: true });

    writeFileSync(join(mindmodelDir, "constraints.md"), "# Architecture Constraints\n\nRules.\n");
    writeFileSync(join(mindmodelDir, "patterns.md"), "# Patterns & Conventions\n\nPatterns.\n");

    const mindmodel = await loadMindmodel(testDir);
    const byPath = new Map(mindmodel!.manifest.categories.map((c) => [c.path, c.description]));

    // The H1 is what keyword matching runs against, so "constraints" has to be
    // in the description and not only in the filename.
    expect(byPath.get("constraints.md")).toBe("Architecture Constraints");
    expect(byPath.get("patterns.md")).toBe("Patterns & Conventions");
  });

  it("descends into subdirectories when there is no manifest", async () => {
    const mindmodelDir = join(testDir, ".mindmodel");
    mkdirSync(join(mindmodelDir, "patterns"), { recursive: true });

    writeFileSync(join(mindmodelDir, "patterns/logging.md"), "# Logging\n\nUse the logger.\n");
    writeFileSync(join(mindmodelDir, "overview.md"), "# Overview\n\nWhat this is.\n");

    const mindmodel = await loadMindmodel(testDir);

    expect(mindmodel?.manifest.categories.map((c) => c.path)).toEqual(["overview.md", "patterns/logging.md"]);
  });

  it("falls back to the filename when a constraint file has no H1", async () => {
    const mindmodelDir = join(testDir, ".mindmodel");
    mkdirSync(mindmodelDir, { recursive: true });

    writeFileSync(join(mindmodelDir, "orphan.md"), "No heading at all, just prose.\n");

    const mindmodel = await loadMindmodel(testDir);

    // Matching on the name beats matching on nothing.
    expect(mindmodel?.manifest.categories[0].description).toBe("orphan");
  });

  it("says so when it has inferred a manifest", async () => {
    const mindmodelDir = join(testDir, ".mindmodel");
    mkdirSync(mindmodelDir, { recursive: true });
    writeFileSync(join(mindmodelDir, "patterns.md"), "# Patterns\n\nPatterns.\n");

    await loadMindmodel(testDir);

    // Silent derivation would be indistinguishable from a real manifest, and
    // the first thing anyone asks is why a description is wrong.
    expect(logs.info).toHaveLength(1);
    expect(logs.info[0]).toContain("derived 1 categories");
    expect(logs.info[0]).toContain("Add a manifest");
    expect(logs.warn).toEqual([]);
  });

  it("returns null when there is no manifest and no markdown either", async () => {
    const mindmodelDir = join(testDir, ".mindmodel");
    mkdirSync(mindmodelDir, { recursive: true });
    writeFileSync(join(mindmodelDir, "notes.txt"), "not markdown\n");

    expect(await loadMindmodel(testDir)).toBeNull();
    expect(logs.warn).toEqual(["[mindmodel] No manifest.yaml and no markdown files in .mindmodel/"]);
  });

  it("does not read manifest.yaml as a constraint file", async () => {
    const mindmodelDir = join(testDir, ".mindmodel");
    mkdirSync(mindmodelDir, { recursive: true });

    writeFileSync(
      join(mindmodelDir, "manifest.yaml"),
      `
name: test
version: 1
categories:
  - path: logging.md
    description: Logging patterns
`,
    );
    writeFileSync(join(mindmodelDir, "logging.md"), "# Logging\n\nUse the logger.\n");

    const mindmodel = await loadMindmodel(testDir);

    // A present manifest wins outright; the derived path never runs, and the
    // manifest file is not mistaken for a constraint file needing an H1.
    expect(mindmodel?.manifest.name).toBe("test");
    expect(mindmodel?.manifest.categories.map((c) => c.path)).toEqual(["logging.md"]);
    expect(logs.info).toEqual([]);
  });

  it("still reports a malformed manifest as a failure rather than deriving one", async () => {
    const mindmodelDir = join(testDir, ".mindmodel");
    mkdirSync(mindmodelDir, { recursive: true });

    writeFileSync(join(mindmodelDir, "manifest.yaml"), "name: test\ncategories: []\n");
    writeFileSync(join(mindmodelDir, "patterns.md"), "# Patterns\n\nPatterns.\n");

    // Inferring around a broken manifest would hide the user's mistake. A
    // manifest that exists and is wrong is a different problem from one that
    // was never written.
    expect(await loadMindmodel(testDir)).toBeNull();
    expect(logs.warn[0]).toContain("Failed to load manifest");
  });
});
