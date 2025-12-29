// src/tools/artifact-index/index.ts
import { Database } from "bun:sqlite";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { mkdirSync, existsSync } from "fs";
import { homedir } from "os";

const DEFAULT_DB_DIR = join(homedir(), ".config", "opencode", "artifact-index");
const DB_NAME = "context.db";

export interface HandoffRecord {
  id: string;
  sessionName?: string;
  filePath: string;
  taskSummary?: string;
  whatWorked?: string;
  whatFailed?: string;
  learnings?: string;
  outcome?: "SUCCEEDED" | "PARTIAL_PLUS" | "PARTIAL_MINUS" | "FAILED" | "UNKNOWN";
}

export interface PlanRecord {
  id: string;
  title?: string;
  filePath: string;
  overview?: string;
  approach?: string;
}

export interface LedgerRecord {
  id: string;
  sessionName?: string;
  filePath: string;
  goal?: string;
  stateNow?: string;
  keyDecisions?: string;
}

export interface SearchResult {
  type: "handoff" | "plan" | "ledger";
  id: string;
  filePath: string;
  title?: string;
  summary?: string;
  score: number;
}

export class ArtifactIndex {
  private db: Database | null = null;
  private dbPath: string;

  constructor(dbDir: string = DEFAULT_DB_DIR) {
    this.dbPath = join(dbDir, DB_NAME);
  }

  async initialize(): Promise<void> {
    // Ensure directory exists
    const dir = dirname(this.dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(this.dbPath);
    
    // Load and execute schema
    const schemaPath = join(dirname(import.meta.path), "schema.sql");
    let schema: string;
    
    try {
      schema = readFileSync(schemaPath, "utf-8");
    } catch {
      // Fallback: inline schema for when bundled
      schema = this.getInlineSchema();
    }
    
    // Execute schema - use exec for multi-statement support
    this.db.exec(schema);
  }

  private getInlineSchema(): string {
    return `
      CREATE TABLE IF NOT EXISTS handoffs (
        id TEXT PRIMARY KEY,
        session_name TEXT,
        file_path TEXT UNIQUE NOT NULL,
        task_summary TEXT,
        what_worked TEXT,
        what_failed TEXT,
        learnings TEXT,
        outcome TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        indexed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS plans (
        id TEXT PRIMARY KEY,
        title TEXT,
        file_path TEXT UNIQUE NOT NULL,
        overview TEXT,
        approach TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        indexed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS ledgers (
        id TEXT PRIMARY KEY,
        session_name TEXT,
        file_path TEXT UNIQUE NOT NULL,
        goal TEXT,
        state_now TEXT,
        key_decisions TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        indexed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS handoffs_fts USING fts5(id, session_name, task_summary, what_worked, what_failed, learnings);
      CREATE VIRTUAL TABLE IF NOT EXISTS plans_fts USING fts5(id, title, overview, approach);
      CREATE VIRTUAL TABLE IF NOT EXISTS ledgers_fts USING fts5(id, session_name, goal, state_now, key_decisions);
    `;
  }

  async indexHandoff(record: HandoffRecord): Promise<void> {
    if (!this.db) throw new Error("Database not initialized");

    // Check for existing record by file_path to clean up old FTS entry
    const existing = this.db.query<{ id: string }, [string]>(
      `SELECT id FROM handoffs WHERE file_path = ?`
    ).get(record.filePath);
    if (existing) {
      this.db.run(`DELETE FROM handoffs_fts WHERE id = ?`, [existing.id]);
    }

    // Upsert handoff
    this.db.run(`
      INSERT INTO handoffs (id, session_name, file_path, task_summary, what_worked, what_failed, learnings, outcome, indexed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(file_path) DO UPDATE SET
        id = excluded.id,
        session_name = excluded.session_name,
        task_summary = excluded.task_summary,
        what_worked = excluded.what_worked,
        what_failed = excluded.what_failed,
        learnings = excluded.learnings,
        outcome = excluded.outcome,
        indexed_at = CURRENT_TIMESTAMP
    `, [record.id, record.sessionName ?? null, record.filePath, record.taskSummary ?? null, record.whatWorked ?? null, record.whatFailed ?? null, record.learnings ?? null, record.outcome ?? null]);

    // Insert new FTS entry
    this.db.run(`
      INSERT INTO handoffs_fts (id, session_name, task_summary, what_worked, what_failed, learnings)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [record.id, record.sessionName ?? null, record.taskSummary ?? null, record.whatWorked ?? null, record.whatFailed ?? null, record.learnings ?? null]);
  }

  async indexPlan(record: PlanRecord): Promise<void> {
    if (!this.db) throw new Error("Database not initialized");

    // Check for existing record by file_path to clean up old FTS entry
    const existing = this.db.query<{ id: string }, [string]>(
      `SELECT id FROM plans WHERE file_path = ?`
    ).get(record.filePath);
    if (existing) {
      this.db.run(`DELETE FROM plans_fts WHERE id = ?`, [existing.id]);
    }

    this.db.run(`
      INSERT INTO plans (id, title, file_path, overview, approach, indexed_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(file_path) DO UPDATE SET
        id = excluded.id,
        title = excluded.title,
        overview = excluded.overview,
        approach = excluded.approach,
        indexed_at = CURRENT_TIMESTAMP
    `, [record.id, record.title ?? null, record.filePath, record.overview ?? null, record.approach ?? null]);

    this.db.run(`
      INSERT INTO plans_fts (id, title, overview, approach)
      VALUES (?, ?, ?, ?)
    `, [record.id, record.title ?? null, record.overview ?? null, record.approach ?? null]);
  }

  async indexLedger(record: LedgerRecord): Promise<void> {
    if (!this.db) throw new Error("Database not initialized");

    // Check for existing record by file_path to clean up old FTS entry
    const existing = this.db.query<{ id: string }, [string]>(
      `SELECT id FROM ledgers WHERE file_path = ?`
    ).get(record.filePath);
    if (existing) {
      this.db.run(`DELETE FROM ledgers_fts WHERE id = ?`, [existing.id]);
    }

    this.db.run(`
      INSERT INTO ledgers (id, session_name, file_path, goal, state_now, key_decisions, indexed_at)
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(file_path) DO UPDATE SET
        id = excluded.id,
        session_name = excluded.session_name,
        goal = excluded.goal,
        state_now = excluded.state_now,
        key_decisions = excluded.key_decisions,
        indexed_at = CURRENT_TIMESTAMP
    `, [record.id, record.sessionName ?? null, record.filePath, record.goal ?? null, record.stateNow ?? null, record.keyDecisions ?? null]);

    this.db.run(`
      INSERT INTO ledgers_fts (id, session_name, goal, state_now, key_decisions)
      VALUES (?, ?, ?, ?, ?)
    `, [record.id, record.sessionName ?? null, record.goal ?? null, record.stateNow ?? null, record.keyDecisions ?? null]);
  }

  async search(query: string, limit: number = 10): Promise<SearchResult[]> {
    if (!this.db) throw new Error("Database not initialized");

    const results: SearchResult[] = [];
    const escapedQuery = this.escapeFtsQuery(query);

    // Search handoffs
    const handoffs = this.db.query<{ id: string; file_path: string; task_summary: string; rank: number }, [string, number]>(`
      SELECT h.id, h.file_path, h.task_summary, rank
      FROM handoffs_fts
      JOIN handoffs h ON handoffs_fts.id = h.id
      WHERE handoffs_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `).all(escapedQuery, limit);

    for (const row of handoffs) {
      results.push({
        type: "handoff",
        id: row.id,
        filePath: row.file_path,
        summary: row.task_summary,
        score: -row.rank, // FTS5 rank is negative, lower is better
      });
    }

    // Search plans
    const plans = this.db.query<{ id: string; file_path: string; title: string; rank: number }, [string, number]>(`
      SELECT p.id, p.file_path, p.title, rank
      FROM plans_fts
      JOIN plans p ON plans_fts.id = p.id
      WHERE plans_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `).all(escapedQuery, limit);

    for (const row of plans) {
      results.push({
        type: "plan",
        id: row.id,
        filePath: row.file_path,
        title: row.title,
        score: -row.rank,
      });
    }

    // Search ledgers
    const ledgers = this.db.query<{ id: string; file_path: string; session_name: string; goal: string; rank: number }, [string, number]>(`
      SELECT l.id, l.file_path, l.session_name, l.goal, rank
      FROM ledgers_fts
      JOIN ledgers l ON ledgers_fts.id = l.id
      WHERE ledgers_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `).all(escapedQuery, limit);

    for (const row of ledgers) {
      results.push({
        type: "ledger",
        id: row.id,
        filePath: row.file_path,
        title: row.session_name,
        summary: row.goal,
        score: -row.rank,
      });
    }

    // Sort all results by score descending
    results.sort((a, b) => b.score - a.score);

    return results.slice(0, limit);
  }

  private escapeFtsQuery(query: string): string {
    // Escape special FTS5 characters and wrap terms in quotes
    return query
      .replace(/['"]/g, "")
      .split(/\s+/)
      .filter(term => term.length > 0)
      .map(term => `"${term}"`)
      .join(" OR ");
  }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

// Singleton instance for global use
let globalIndex: ArtifactIndex | null = null;

export async function getArtifactIndex(): Promise<ArtifactIndex> {
  if (!globalIndex) {
    globalIndex = new ArtifactIndex();
    await globalIndex.initialize();
  }
  return globalIndex;
}
