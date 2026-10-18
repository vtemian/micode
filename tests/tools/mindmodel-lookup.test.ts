import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createMindmodelLookupTool } from "../../src/tools/mindmodel-lookup";
import { captureLogs, type LogCapture } from "../helpers/log-capture";

async function writeMindmodel(dir: string, category: string, body: string): Promise<void> {
  const root = join(dir, ".mindmodel");
  await mkdir(root, { recursive: true });
  await writeFile(
    join(root, "manifest.yaml"),
    `name: t\nversion: 2\ncategories:\n  - path: ${category}.md\n    description: ${category} patterns\n`,
  );
  await writeFile(join(root, `${category}.md`), body);
}

describe("createMindmodelLookupTool", () => {
  let dirs: string[];
  let logs: LogCapture;

  beforeEach(() => {
    dirs = [];
    logs = captureLogs();
  });

  afterEach(async () => {
    logs.restore();
    await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function workspace(): Promise<{ directory: string }> {
    const directory = await mkdtemp(join(tmpdir(), "micode-lookup-"));
    dirs.push(directory);
    return { directory };
  }

  it("serves each workspace its own mindmodel", async () => {
    const a = await workspace();
    const b = await workspace();
    await writeMindmodel(a.directory, "alpha", "ALPHA BODY");
    await writeMindmodel(b.directory, "bravo", "BRAVO BODY");
    const toolA = createMindmodelLookupTool(a).mindmodel_lookup;
    const toolB = createMindmodelLookupTool(b).mindmodel_lookup;

    const fromA = await toolA.execute({ query: "alpha patterns" }, {});
    const fromB = await toolB.execute({ query: "bravo patterns" }, {});

    expect(fromA).toContain("ALPHA BODY");
    expect(fromB).toContain("BRAVO BODY");
    expect(logs.info.length).toBeGreaterThan(0);
  });

  it("reports a missing mindmodel without borrowing another workspace's", async () => {
    const a = await workspace();
    const empty = await workspace();
    await writeMindmodel(a.directory, "alpha", "ALPHA BODY");
    await createMindmodelLookupTool(a).mindmodel_lookup.execute({ query: "alpha" }, {});

    const reply = await createMindmodelLookupTool(empty).mindmodel_lookup.execute({ query: "alpha" }, {});

    expect(reply).toContain("No .mindmodel/ directory found");
    expect(logs.info.length).toBeGreaterThan(0);
  });
});
