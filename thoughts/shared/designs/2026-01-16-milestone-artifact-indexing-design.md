---
title: Milestone Artifact Indexing Design
date: 2026-01-16
status: draft
---

# Problem Statement
We need a milestone-driven artifact indexing strategy that supports reliable search and retrieval while keeping legacy plan/ledger indexing behavior unchanged.

# Constraints
- Milestone-driven artifacts are stored only in SQLite.
- Do not link to milestone summaries.
- Legacy plan/ledger indexing remains untouched.

# Approach
Introduce a classifier that selects exactly one artifact type per milestone-driven artifact using clear criteria and an explicit tie-break order (feature > decision > session). The selected type is stored alongside metadata, and the milestone identifier is saved in the artifact metadata for downstream filtering and retrieval. No milestone summary links are generated as part of this flow.

# Architecture
All milestone-driven artifacts are stored only in SQLite with a classifier-driven type field and metadata payload. The indexing pipeline is isolated from legacy plan/ledger indexing to avoid behavioral changes.

# Components
- SQLite artifact store (milestone-driven artifacts only).
- Classification agent that assigns a single artifact type.
- Indexing pipeline that writes metadata, type, and payload.
- Search/query layer that filters by milestone metadata.

# Metadata Fields
- milestone_id (stored in metadata for filtering and retrieval)
- artifact_type
- source_session_id
- created_at
- tags

# Metadata Fields (Explicit)
- milestone_id (stored in metadata for filtering and retrieval)
- artifact_type
- source_session_id
- created_at
- tags

# Data Flow
1. Artifact ingested for a milestone.
2. Classification agent selects exactly one type using criteria:
   - Feature: milestone content includes scoped implementation details, requirements, or capability changes.
   - Decision: milestone content captures a resolved choice, trade-off, or rationale.
   - Session: milestone content is primarily meeting notes, status updates, or discussion without a decision.
   - Tie-break: prefer feature over decision over session when multiple criteria match.
3. Artifact metadata is persisted with the milestone identifier.
4. Artifact is written to SQLite for indexing and search.

# Error Handling
- If classification fails, fall back to storing the artifact as a session artifact (mandatory).
- Fallback to a session artifact on classifier failure is mandatory for all ingests.
- Log the classification failure for follow-up without blocking ingestion.

# Testing Strategy
- Classification tests (e.g., `tests/indexing/classifier/*.test.ts`) verify criteria for feature/decision/session and the tie-break behavior.
- Flow tests (e.g., `tests/indexing/flows/milestone-ingest.test.ts`) validate ingest → classify → persist metadata → SQLite storage.
- Search tests (e.g., `tests/indexing/search/milestone-search.test.ts`) confirm milestone metadata filtering and indexed-only results.
- Error path tests (e.g., `tests/indexing/flows/milestone-error-paths.test.ts`) cover classifier failures, required session fallback, and logging.

# Open Questions
- What criteria should the classifier use to distinguish feature versus decision when both are plausible?
- Should milestone metadata include a normalized milestone slug in addition to the identifier?
- Do we need a backfill path for previously ingested milestone artifacts?
