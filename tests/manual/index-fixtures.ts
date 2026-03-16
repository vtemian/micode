#!/usr/bin/env bun

// Script to index test fixtures into the artifact database
// Run: bun tests/manual/index-fixtures.ts

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ArtifactIndex } from "../../src/tools/artifact-index";

const FIXTURES_DIR = "./thoughts";

async function indexFixtures() {
  console.log("Indexing test fixtures...\n");

  const index = new ArtifactIndex();
  await index.initialize();

  // Index ledgers
  const ledgersDir = join(FIXTURES_DIR, "ledgers");
  try {
    const ledgerFiles = readdirSync(ledgersDir).filter((f) => f.endsWith(".md"));
    for (const file of ledgerFiles) {
      const filePath = join(ledgersDir, file);
      const content = readFileSync(filePath, "utf-8");

      // Extract session name from filename
      const sessionName = file.replace("CONTINUITY_", "").replace(".md", "");

      // Extract goal from content
      const goalMatch = content.match(/## Goal\n([^\n]+)/);
      const goal = goalMatch?.[1] || "";

      // Extract state
      const stateMatch = content.match(/- Now: ([^\n]+)/);
      const stateNow = stateMatch?.[1] || "";

      // Extract key decisions
      const decisionsMatch = content.match(/## Key Decisions\n([\s\S]*?)(?=\n## |$)/);
      const keyDecisions = decisionsMatch?.[1]?.trim() || "";

      await index.indexLedger({
        id: `ledger-${sessionName}`,
        sessionName,
        filePath,
        goal,
        stateNow,
        keyDecisions,
      });
      console.log(`✓ Indexed ledger: ${file}`);
    }
  } catch (e) {
    console.log("No ledgers directory or error:", e);
  }

  // Index handoffs
  const handoffsDir = join(FIXTURES_DIR, "shared/handoffs");
  try {
    const handoffFiles = readdirSync(handoffsDir).filter((f) => f.endsWith(".md"));
    for (const file of handoffFiles) {
      const filePath = join(handoffsDir, file);
      const content = readFileSync(filePath, "utf-8");

      // Extract task summary (first heading after frontmatter)
      const taskMatch = content.match(/## Tasks[\s\S]*?\n\n## Current State\n\n\*\*Working on:\*\* ([^\n]+)/);
      const taskSummary = taskMatch?.[1] || file;

      // Extract learnings
      const learningsMatch = content.match(/## Learnings\n\n([\s\S]*?)(?=\n## |$)/);
      const learnings = learningsMatch?.[1]?.trim() || "";

      // Extract what worked (from learnings for now)
      const whatWorked = learnings;

      await index.indexHandoff({
        id: `handoff-${file.replace(".md", "")}`,
        sessionName: file.replace(".md", ""),
        filePath,
        taskSummary,
        whatWorked,
        learnings,
        outcome: "SUCCEEDED",
      });
      console.log(`✓ Indexed handoff: ${file}`);
    }
  } catch (e) {
    console.log("No handoffs directory or error:", e);
  }

  // Index plans
  const plansDir = join(FIXTURES_DIR, "shared/plans");
  try {
    const planFiles = readdirSync(plansDir).filter((f) => f.endsWith(".md"));
    for (const file of planFiles) {
      const filePath = join(plansDir, file);
      const content = readFileSync(filePath, "utf-8");

      // Extract title (first heading)
      const titleMatch = content.match(/^# (.+)$/m);
      const title = titleMatch?.[1] || file;

      // Extract overview
      const overviewMatch = content.match(/## Overview\n\n([\s\S]*?)(?=\n## |$)/);
      const overview = overviewMatch?.[1]?.trim() || "";

      // Extract approach
      const approachMatch = content.match(/## Approach\n\n([\s\S]*?)(?=\n## |$)/);
      const approach = approachMatch?.[1]?.trim() || "";

      await index.indexPlan({
        id: `plan-${file.replace(".md", "")}`,
        title,
        filePath,
        overview,
        approach,
      });
      console.log(`✓ Indexed plan: ${file}`);
    }
  } catch (e) {
    console.log("No plans directory or error:", e);
  }

  await index.close();

  console.log("\n✅ Indexing complete!");
  console.log("Database location: ~/.config/opencode/artifact-index/context.db");
  console.log("\nNow try: /search oauth");
}

indexFixtures().catch(console.error);
