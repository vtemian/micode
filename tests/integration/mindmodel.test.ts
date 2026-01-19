// tests/integration/mindmodel.test.ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
`,
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
`,
    );

    // Test the full pipeline
    const { loadMindmodel, loadExamples, formatExamplesForInjection } = await import("../../src/mindmodel");

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
