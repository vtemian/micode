import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("milestone artifact search", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `milestone-search-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("filters by milestone metadata", async () => {
    const { ArtifactIndex } = await import("../../../src/tools/artifact-index");
    const index = new ArtifactIndex(testDir);
    await index.initialize();

    try {
      await index.indexMilestoneArtifact({
        id: "artifact-1",
        milestoneId: "ms-1",
        artifactType: "feature",
        sourceSessionId: "session-1",
        createdAt: "2026-01-16T10:00:00Z",
        tags: ["feature"],
        payload: "Implementation details for milestone indexing.",
      });

      await index.indexMilestoneArtifact({
        id: "artifact-2",
        milestoneId: "ms-2",
        artifactType: "decision",
        sourceSessionId: "session-2",
        createdAt: "2026-01-16T11:00:00Z",
        tags: ["decision"],
        payload: "Decision to store artifacts only in SQLite.",
      });

      const results = await index.searchMilestoneArtifacts("SQLite", {
        milestoneId: "ms-2",
        artifactType: "decision",
        limit: 10,
      });

      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        id: "artifact-2",
        milestoneId: "ms-2",
        artifactType: "decision",
      });
    } finally {
      await index.close();
    }
  });
});
