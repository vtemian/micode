// tests/tools/ast-grep/index.test.ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createAstGrepTools, replaceCall, searchCall } from "../../../src/tools/ast-grep";
import { findExecutable } from "../../../src/utils/process";

const CTX = { sessionID: "s1", progress: () => {} };

describe("ast-grep tools", () => {
  let directory: string;

  beforeEach(() => {
    directory = realpathSync(mkdtempSync(join(tmpdir(), "micode-ast-grep-")));
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it("searches the workspace directory, not the process cwd, when no paths are given", () => {
    expect(process.cwd()).not.toBe(directory);
    const call = searchCall({ directory }, { pattern: "foo($A)", lang: "typescript" });
    expect(call.cwd).toBe(directory);
    expect(call.args).toEqual(["run", "-p", "foo($A)", "--lang", "typescript", "--json=compact", directory]);
  });

  it("runs explicit relative paths from the workspace directory", () => {
    const call = searchCall({ directory }, { pattern: "x", lang: "go", paths: ["src", "lib"] });
    expect(call.cwd).toBe(directory);
    expect(call.args.slice(-2)).toEqual(["src", "lib"]);
  });

  it("builds a dry-run replace in the workspace and adds --update-all only when applying", () => {
    const dry = replaceCall({ directory }, { pattern: "a", rewrite: "b", lang: "python" });
    expect(dry.cwd).toBe(directory);
    expect(dry.args).toEqual(["run", "-p", "a", "-r", "b", "--lang", "python", "--json=compact", directory]);

    const applied = replaceCall({ directory }, { pattern: "a", rewrite: "b", lang: "python", apply: true });
    expect(applied.args).toContain("--update-all");
    expect(applied.args.at(-1)).toBe(directory);
  });

  it.skipIf(!findExecutable("sg"))("finds a match in a file that exists only in the workspace", async () => {
    writeFileSync(join(directory, "only-here.ts"), "foo(1);\n");
    const tools = createAstGrepTools({ directory });
    const output = await tools.ast_grep_search.execute({ pattern: "foo($A)", lang: "typescript" }, CTX);
    expect(output).toContain("only-here.ts");
  });
});
