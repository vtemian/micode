// src/tools/octto/types.ts

import type { ToolContext, ToolResult } from "@opencode-ai/plugin/tool";
import type { createOpencodeClient } from "@opencode-ai/sdk";

// Avoids exposing zod types in declaration files.
// The actual tools are typesafe via zod schemas.
// `args` holds a zod schema (type-erased here); `execute` uses `never` parameter
// so any typed implementation is assignable (contravariance) while signaling
// that callers should not invoke execute directly through this interface.
export interface OcttoTool {
  description: string;
  args: unknown;
  execute: (args: never, context: ToolContext) => Promise<ToolResult>;
}

export type OcttoTools = Record<string, OcttoTool>;

export type OpencodeClient = ReturnType<typeof createOpencodeClient>;

export interface OcttoSessionTracker {
  onCreated?: (parentSessionId: string, octtoSessionId: string) => void;
  onEnded?: (parentSessionId: string, octtoSessionId: string) => void;
}
