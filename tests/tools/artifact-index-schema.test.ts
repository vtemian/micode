import { describe, it, expect } from "bun:test";

describe("artifact-index schema", () => {
  it("should not have handoff tables", async () => {
    const fs = await import("node:fs/promises");
    const schema = await fs.readFile("src/tools/artifact-index/schema.sql", "utf-8");
    expect(schema).not.toContain("CREATE TABLE IF NOT EXISTS handoffs");
    expect(schema).not.toContain("CREATE VIRTUAL TABLE IF NOT EXISTS handoffs_fts");
  });

  it("should still have ledgers and plans tables", async () => {
    const fs = await import("node:fs/promises");
    const schema = await fs.readFile("src/tools/artifact-index/schema.sql", "utf-8");
    expect(schema).toContain("CREATE TABLE IF NOT EXISTS ledgers");
    expect(schema).toContain("CREATE TABLE IF NOT EXISTS plans");
    expect(schema).toContain("CREATE VIRTUAL TABLE IF NOT EXISTS ledgers_fts");
    expect(schema).toContain("CREATE VIRTUAL TABLE IF NOT EXISTS plans_fts");
  });

  it("should have files_read and files_modified columns in ledgers", async () => {
    const fs = await import("node:fs/promises");
    const schema = await fs.readFile("src/tools/artifact-index/schema.sql", "utf-8");
    expect(schema).toContain("files_read TEXT");
    expect(schema).toContain("files_modified TEXT");
  });
});
