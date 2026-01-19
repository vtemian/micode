// tests/mindmodel/types.test.ts
import { describe, expect, it } from "bun:test";

import { type MindmodelManifest, parseManifest } from "../../src/mindmodel/types";

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
