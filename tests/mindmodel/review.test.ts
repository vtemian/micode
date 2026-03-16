// tests/mindmodel/review.test.ts
import { describe, expect, it } from "bun:test";

import { parseReviewResponse } from "../../src/mindmodel/review";

describe("parseReviewResponse", () => {
  it("should parse PASS response", () => {
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
  });

  it("should parse BLOCKED response with violations", () => {
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
  });

  it("should handle raw JSON without code blocks", () => {
    const response = `{"status": "PASS", "violations": [], "summary": "OK"}`;
    const result = parseReviewResponse(response);
    expect(result.status).toBe("PASS");
  });
});
