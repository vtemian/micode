// tests/mindmodel/types.test.ts
import { describe, expect, it } from "bun:test";

import { parseManifest } from "../../src/mindmodel/types";

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

  it("should throw on malformed YAML", () => {
    const yaml = `name: test
categories:
  - path: [invalid nested`;
    expect(() => parseManifest(yaml)).toThrow();
  });
});

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

describe("ConstraintFileSchema", () => {
  it("should parse constraint file with rules, examples, and anti-patterns", () => {
    const { parseConstraintFile } = require("../../src/mindmodel/types");
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
    const { parseConstraintFile } = require("../../src/mindmodel/types");
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
