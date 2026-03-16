// tests/integration/mindmodel-v2.test.ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
    group: patterns`,
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
`,
    );

    const mindmodel = await loadMindmodel(tempDir);
    expect(mindmodel).not.toBeNull();
    expect(mindmodel?.manifest.version).toBe(2);
    expect(mindmodel?.manifest.categories[0].group).toBe("patterns");
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
    expect(formatted).toContain("Blocked");
    expect(formatted).toContain("Use internal client");
    expect(formatted).toContain("patterns/api.md");
  });

  it("should format violations for retry with context", async () => {
    const { formatViolationsForRetry } = await import("../../src/mindmodel");

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

    const formatted = formatViolationsForRetry(violations);
    expect(formatted).toContain("previous attempt had constraint violations");
    expect(formatted).toContain("Found: fetch()");
    expect(formatted).toContain("Expected: apiClient.get()");
    expect(formatted).toContain("See: patterns/api.md");
    expect(formatted).toContain("Please fix these issues");
  });

  it("should parse PASS review response", async () => {
    const { parseReviewResponse } = await import("../../src/mindmodel");

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
    expect(result.summary).toBe("Code follows all constraints.");
  });

  it("should parse BLOCKED review response with violations", async () => {
    const { parseReviewResponse } = await import("../../src/mindmodel");

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
    expect(result.violations[0].line).toBe(15);
  });

  it("should handle raw JSON without code blocks", async () => {
    const { parseReviewResponse } = await import("../../src/mindmodel");

    const response = `{"status": "PASS", "violations": [], "summary": "OK"}`;
    const result = parseReviewResponse(response);
    expect(result.status).toBe("PASS");
  });

  it("should load examples from v2 manifest structure", async () => {
    const { loadMindmodel, loadExamples, formatExamplesForInjection } = await import("../../src/mindmodel");

    // Setup v2 .mindmodel directory with grouped structure
    await mkdir(join(tempDir, ".mindmodel", "patterns"), { recursive: true });
    await mkdir(join(tempDir, ".mindmodel", "style"), { recursive: true });

    await writeFile(
      join(tempDir, ".mindmodel", "manifest.yaml"),
      `name: test-project
version: 2
categories:
  - path: patterns/error-handling.md
    description: Error handling patterns
    group: patterns
  - path: style/naming.md
    description: Naming conventions
    group: style`,
    );

    await writeFile(
      join(tempDir, ".mindmodel", "patterns", "error-handling.md"),
      `# Error Handling

## Rules
- Always wrap errors with context
- Never swallow errors silently

## Examples

### Wrapping errors
\`\`\`typescript example
if (err) {
  throw new AppError("operation failed", err);
}
\`\`\`

## Anti-patterns

### Swallowing errors
\`\`\`typescript
if (err) {
  return null; // BAD
}
\`\`\`
`,
    );

    await writeFile(
      join(tempDir, ".mindmodel", "style", "naming.md"),
      `# Naming Conventions

## Rules
- Use camelCase for functions
- Use PascalCase for types

## Examples

### Function naming
\`\`\`typescript example
function getUserById(id: string) {}
\`\`\`
`,
    );

    const mindmodel = await loadMindmodel(tempDir);
    expect(mindmodel).not.toBeNull();
    expect(mindmodel?.manifest.categories).toHaveLength(2);

    const examples = await loadExamples(mindmodel!, ["patterns/error-handling.md", "style/naming.md"]);
    expect(examples).toHaveLength(2);

    const formatted = formatExamplesForInjection(examples);
    expect(formatted).toContain("mindmodel-examples");
    expect(formatted).toContain("Error handling patterns");
    expect(formatted).toContain("Naming conventions");
  });

  it("should handle missing optional fields gracefully", async () => {
    const { parseReviewResponse, formatViolationsForUser } = await import("../../src/mindmodel");

    // Test review response with missing summary
    const response = `{"status": "PASS", "violations": []}`;
    const result = parseReviewResponse(response);
    expect(result.status).toBe("PASS");
    expect(result.summary).toBe("");

    // Test empty violations
    const formatted = formatViolationsForUser([]);
    expect(formatted).toBe("");
  });

  it("should handle malformed JSON review response gracefully", async () => {
    const { parseReviewResponse } = await import("../../src/mindmodel");

    const response = `This is not JSON at all`;
    const result = parseReviewResponse(response);
    // Should default to PASS to avoid false blocks
    expect(result.status).toBe("PASS");
    expect(result.violations).toHaveLength(0);
  });

  it("should support backward compatible v1 manifest without groups", async () => {
    const { loadMindmodel } = await import("../../src/mindmodel");

    await mkdir(join(tempDir, ".mindmodel", "components"), { recursive: true });

    await writeFile(
      join(tempDir, ".mindmodel", "manifest.yaml"),
      `name: test-project
version: 1
categories:
  - path: components/button.md
    description: Button patterns`,
    );

    await writeFile(
      join(tempDir, ".mindmodel", "components", "button.md"),
      `# Button

Use standard button component.
`,
    );

    const mindmodel = await loadMindmodel(tempDir);
    expect(mindmodel).not.toBeNull();
    expect(mindmodel?.manifest.version).toBe(1);
    expect(mindmodel?.manifest.categories[0].group).toBeUndefined();
  });
});
