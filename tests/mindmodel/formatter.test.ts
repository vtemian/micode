// tests/mindmodel/formatter.test.ts
import { describe, expect, it } from "bun:test";

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
