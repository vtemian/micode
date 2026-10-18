import { describe, expect, it } from "bun:test";

import { patchedFiles } from "../../src/utils/patch";

const PATCH = [
  "*** Begin Patch",
  "*** Update File: src/a.ts",
  "@@ const a = 1;",
  "-const b = 2;",
  "+const b = 3;",
  "*** Add File: docs/new.md",
  "+# New",
  "+body",
  "*** Delete File: old.txt",
  "*** Update File: src/old-name.ts",
  "*** Move to: src/new-name.ts",
  "@@",
  "+moved",
  "*** End Patch",
].join("\n");

describe("patchedFiles", () => {
  it("lists every added, updated and moved file with the lines it adds", () => {
    expect(patchedFiles(PATCH)).toEqual([
      { path: "src/a.ts", added: "const b = 3;" },
      { path: "docs/new.md", added: "# New\nbody" },
      { path: "src/new-name.ts", added: "moved" },
    ]);
  });

  it("skips deleted files, which leave nothing to track or review", () => {
    expect(patchedFiles("*** Begin Patch\n*** Delete File: gone.ts\n*** End Patch")).toEqual([]);
  });

  it("returns nothing for text that is not a patch", () => {
    expect(patchedFiles("just words")).toEqual([]);
  });
});
