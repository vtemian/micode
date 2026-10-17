// src/tools/octto/types.ts

export type { MicodeTool as OcttoTool, MicodeTools as OcttoTools } from "@/tools/define";

export interface OcttoSessionTracker {
  onCreated?: (parentSessionId: string, octtoSessionId: string) => void;
  onEnded?: (parentSessionId: string, octtoSessionId: string) => void;
}
