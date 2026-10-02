// tests/tools/mindmodel-lookup.test.ts
import { describe, expect, it } from "bun:test";

import type { LoadedExample, LoadedMindmodel } from "../../src/mindmodel";
import { matchCategories } from "../../src/tools/mindmodel-lookup";

const manifest: LoadedMindmodel["manifest"] = {
  name: "test",
  version: 1,
  categories: [
    { path: "constraints.md", description: "Architecture Constraints" },
    { path: "patterns/sibling-projects.md", description: "Sibling projects" },
  ],
};

function example(path: string, headings: string[]): LoadedExample {
  return { path, description: "", content: "", headings };
}

describe("mindmodel lookup matching", () => {
  it("matches a query word against the description", () => {
    expect(matchCategories("architecture rules", manifest)).toEqual(["constraints.md"]);
  });

  it("matches a query word against the path", () => {
    expect(matchCategories("sibling", manifest)).toEqual(["patterns/sibling-projects.md"]);
  });

  // The direction that used to be missing. `## Hard rules` is a heading inside
  // a file titled "Architecture Constraints", and a query naming a section has
  // to find it — the old `query.includes(keyword)` only ever tested whether the
  // query contained a description word, so "hard rules" found nothing.
  it("matches a query word that appears only in a heading", () => {
    const examples = new Map([
      ["constraints.md", example("constraints.md", ["Architecture Constraints", "Hard rules"])],
    ]);

    expect(matchCategories("hard rules", manifest, examples)).toEqual(["constraints.md"]);
  });

  it("does not match a query word found only in body prose", () => {
    // Headings are an index; body text is not. Without this, every query would
    // match most files and the tool would inject the whole directory.
    const examples = new Map([["constraints.md", example("constraints.md", ["Architecture Constraints"])]]);

    expect(matchCategories("firefox extension clipboard", manifest, examples)).toEqual([]);
  });

  it("matches on punctuation-insensitive words", () => {
    const examples = new Map([
      ["patterns/sibling-projects.md", example("patterns/sibling-projects.md", ["Sibling projects"])],
    ]);

    expect(matchCategories("sibling_projects", manifest, examples)).toContain("patterns/sibling-projects.md");
  });

  it("returns every match, not just the first", () => {
    const examples = new Map([
      ["constraints.md", example("constraints.md", ["Architecture Constraints", "Hard rules"])],
      ["patterns/sibling-projects.md", example("patterns/sibling-projects.md", ["Sibling projects"])],
    ]);

    expect(matchCategories("projects", manifest, examples)).toEqual(["patterns/sibling-projects.md"]);
    expect(matchCategories("rules projects", manifest, examples)).toEqual([
      "constraints.md",
      "patterns/sibling-projects.md",
    ]);
  });

  it("ignores words too short to be evidence", () => {
    expect(matchCategories("an of to", manifest)).toEqual([]);
  });

  it("returns nothing when the query shares no words", () => {
    expect(matchCategories("kubernetes helm chart", manifest)).toEqual([]);
  });

  it("tolerates a category with no description", () => {
    const withoutDescription: LoadedMindmodel["manifest"] = {
      name: "test",
      version: 1,
      // `description` is optional in the schema, so a manifest can carry one.
      categories: [{ path: "notes.md" } as LoadedMindmodel["manifest"]["categories"][number]],
    };

    expect(matchCategories("notes", withoutDescription)).toEqual(["notes.md"]);
  });
});
