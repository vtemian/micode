// src/octto/state/schemas.ts
import * as v from "valibot";

const BranchQuestionSchema = v.object({
  id: v.string(),
  type: v.string(),
  text: v.string(),
  config: v.record(v.string(), v.unknown()),
  answer: v.optional(v.record(v.string(), v.unknown())),
  answeredAt: v.optional(v.number()),
});

const BranchSchema = v.object({
  id: v.string(),
  scope: v.string(),
  status: v.picklist(["exploring", "done"]),
  questions: v.array(BranchQuestionSchema),
  finding: v.nullable(v.string()),
});

export const BrainstormStateSchema = v.object({
  session_id: v.string(),
  browser_session_id: v.nullable(v.string()),
  request: v.string(),
  created_at: v.number(),
  updated_at: v.number(),
  branches: v.record(v.string(), BranchSchema),
  branch_order: v.array(v.string()),
});
