-- src/tools/artifact-index/schema.sql
-- Artifact Index Schema for SQLite + FTS5
-- NOTE: FTS tables are standalone (not content-linked) and manually synced by code

-- Handoffs table
CREATE TABLE IF NOT EXISTS handoffs (
    id TEXT PRIMARY KEY,
    session_name TEXT,
    file_path TEXT UNIQUE NOT NULL,
    task_summary TEXT,
    what_worked TEXT,
    what_failed TEXT,
    learnings TEXT,
    outcome TEXT CHECK(outcome IN ('SUCCEEDED', 'PARTIAL_PLUS', 'PARTIAL_MINUS', 'FAILED', 'UNKNOWN')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    indexed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Plans table
CREATE TABLE IF NOT EXISTS plans (
    id TEXT PRIMARY KEY,
    title TEXT,
    file_path TEXT UNIQUE NOT NULL,
    overview TEXT,
    approach TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    indexed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Ledgers table
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

-- FTS5 virtual tables for full-text search (standalone, manually synced)
CREATE VIRTUAL TABLE IF NOT EXISTS handoffs_fts USING fts5(
    id,
    session_name,
    task_summary,
    what_worked,
    what_failed,
    learnings
);

CREATE VIRTUAL TABLE IF NOT EXISTS plans_fts USING fts5(
    id,
    title,
    overview,
    approach
);

CREATE VIRTUAL TABLE IF NOT EXISTS ledgers_fts USING fts5(
    id,
    session_name,
    goal,
    state_now,
    key_decisions
);
