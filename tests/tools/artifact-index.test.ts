// tests/tools/artifact-index.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("ArtifactIndex", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `artifact-index-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("should create database on initialization", async () => {
    const { ArtifactIndex } = await import("../../src/tools/artifact-index");
    const index = new ArtifactIndex(testDir);
    await index.initialize();
    
    const dbPath = join(testDir, "context.db");
    expect(Bun.file(dbPath).size).toBeGreaterThan(0);
    
    await index.close();
  });

  it("should index and search handoffs", async () => {
    const { ArtifactIndex } = await import("../../src/tools/artifact-index");
    const index = new ArtifactIndex(testDir);
    await index.initialize();
    
    await index.indexHandoff({
      id: "test-1",
      sessionName: "auth-feature",
      filePath: "/path/to/handoff.md",
      taskSummary: "Implement OAuth authentication",
      whatWorked: "JWT tokens work well",
      whatFailed: "Session refresh had issues",
      learnings: "Use refresh tokens for long sessions",
      outcome: "SUCCEEDED",
    });
    
    const results = await index.search("OAuth authentication");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].type).toBe("handoff");
    
    await index.close();
  });

  it("should index and search plans", async () => {
    const { ArtifactIndex } = await import("../../src/tools/artifact-index");
    const index = new ArtifactIndex(testDir);
    await index.initialize();
    
    await index.indexPlan({
      id: "plan-1",
      title: "API Refactoring Plan",
      filePath: "/path/to/plan.md",
      overview: "Refactor REST API to GraphQL",
      approach: "Incremental migration with adapter layer",
    });
    
    const results = await index.search("GraphQL migration");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].type).toBe("plan");
    
    await index.close();
  });

  it("should index and search ledgers", async () => {
    const { ArtifactIndex } = await import("../../src/tools/artifact-index");
    const index = new ArtifactIndex(testDir);
    await index.initialize();
    
    await index.indexLedger({
      id: "ledger-1",
      sessionName: "database-migration",
      filePath: "/path/to/ledger.md",
      goal: "Migrate from MySQL to PostgreSQL",
      stateNow: "Schema conversion in progress",
      keyDecisions: "Use pgloader for data migration",
    });
    
    const results = await index.search("PostgreSQL migration");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].type).toBe("ledger");
    
    await index.close();
  });
});
