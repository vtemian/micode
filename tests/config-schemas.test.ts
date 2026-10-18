// tests/config-schemas.test.ts
import { describe, expect, it } from "bun:test";

import { parseModelRef, parseModelSelection } from "@/config-schemas";

describe("parseModelSelection", () => {
  it("splits a #variant off the string form", () => {
    expect(parseModelSelection("anthropic/claude-x#high")).toEqual({ ref: "anthropic/claude-x", variant: "high" });
  });

  it("keeps the variant of the object form", () => {
    expect(parseModelSelection({ providerID: "openai", model: "gpt-5", variant: "low" })).toEqual({
      ref: "openai/gpt-5",
      variant: "low",
    });
  });

  it("returns only the ref when no variant is given", () => {
    expect(parseModelSelection("openai/gpt-5")).toEqual({ ref: "openai/gpt-5" });
  });

  it("returns undefined for a ref without a provider", () => {
    expect(parseModelSelection("gpt-5")).toBeUndefined();
  });
});

describe("parseModelRef", () => {
  it("drops the variant", () => {
    expect(parseModelRef("openai/gpt-5#high")).toBe("openai/gpt-5");
  });
});
