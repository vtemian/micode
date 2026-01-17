import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ingestMilestoneArtifact } from "../../../src/indexing/milestone-artifact-ingest";
import { ArtifactIndex } from "../../../src/tools/artifact-index";

describe("milestone artifact ingest", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `milestone-ingest-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("classifies and stores milestone artifacts", async () => {
    const index = new ArtifactIndex(testDir);
    await index.initialize();

    try {
      await ingestMilestoneArtifact(
        {
          id: "artifact-3",
          milestoneId: "ms-3",
          sourceSessionId: "session-3",
          createdAt: "2026-01-16T12:00:00Z",
          tags: ["feature", "milestone"],
          payload: "Implementation details for the indexing pipeline.",
        },
        index,
      );

      const results = await index.searchMilestoneArtifacts("implementation", {
        milestoneId: "ms-3",
        limit: 10,
      });

      expect(results).toHaveLength(1);
      expect(results[0].artifactType).toBe("feature");
    } finally {
      await index.close();
    }
  });
});
