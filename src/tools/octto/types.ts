// src/tools/octto/types.ts

import type { createOpencodeClient } from "@opencode-ai/sdk";

export type { MicodeTool as OcttoTool, MicodeTools as OcttoTools } from "@/tools/define";

export type OpencodeClient = ReturnType<typeof createOpencodeClient>;

export interface OcttoSessionTracker {
  onCreated?: (parentSessionId: string, octtoSessionId: string) => void;
  onEnded?: (parentSessionId: string, octtoSessionId: string) => void;
}
