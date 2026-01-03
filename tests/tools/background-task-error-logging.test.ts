import { describe, it, expect } from "bun:test";

describe("background-task error logging", () => {
  it("should not have silent catch blocks", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/tools/background-task/manager.ts", "utf-8");

    // Should not have empty catch blocks like .catch(() => {})
    expect(source).not.toMatch(/\.catch\s*\(\s*\(\s*\)\s*=>\s*\{\s*\}\s*\)/);

    // Should not have catch blocks that capture error but do nothing
    // e.g., .catch((err) => {}) or .catch((error) => {})
    expect(source).not.toMatch(/\.catch\s*\(\s*\(\s*\w+\s*\)\s*=>\s*\{\s*\}\s*\)/);
  });

  it("should log errors in catch blocks with console.error", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/tools/background-task/manager.ts", "utf-8");

    // Find all .catch blocks with their full body using a more comprehensive regex
    // Match .catch((param) => { ... }) including multiline
    const catchRegex = /\.catch\s*\(\s*\(\s*(\w+)\s*\)\s*=>\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}\s*\)/g;
    const matches = [...source.matchAll(catchRegex)];

    // Should have at least some catch blocks
    expect(matches.length).toBeGreaterThan(0);

    for (const match of matches) {
      const catchBody = match[2];
      // Each catch block body should contain console.error
      expect(catchBody).toContain("console.error");
    }
  });
});
