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
Introduce a classifier that selects exactly one artifact type per milestone-driven artifact using clear criteria. The selected type is stored alongside metadata, and the milestone identifier is saved in the artifact metadata for downstream filtering and retrieval.

# Architecture
Artifacts are stored in SQLite with a classifier-driven type field and metadata payload. The indexing pipeline is isolated from legacy plan/ledger indexing to avoid behavioral changes.

# Components
- SQLite artifact store (milestone-driven artifacts only).
- Classification agent that assigns a single artifact type.
- Indexing pipeline that writes metadata, type, and payload.
- Search/query layer that filters by milestone metadata.

# Metadata Fields
- milestone_id
- artifact_type
- source_session_id
- created_at
- tags

# Data Flow
1. Artifact ingested for a milestone.
2. Classification agent selects one type using criteria:
   - Prefer feature over decision over session when multiple criteria match.
3. Artifact metadata is persisted with the milestone identifier.
4. Artifact is written to SQLite for indexing and search.

# Error Handling
- If classification fails, fall back to storing the artifact as a session artifact.
- Log the classification failure for follow-up without blocking ingestion.

# Testing Strategy
- Classification agent chooses a single type and respects the feature > decision > session tie-break.
- End-to-end flow persists milestone metadata and stores artifacts in SQLite.
- Search filters by milestone metadata and returns only indexed artifacts.
- Error paths cover classifier failures and the session fallback behavior.

# Open Questions
- What criteria should the classifier use to distinguish feature versus decision when both are plausible?
- Should milestone metadata include a normalized milestone slug in addition to the identifier?
- Do we need a backfill path for previously ingested milestone artifacts?
