// src/tools/octto/index.ts

import type { SessionHost, Workspace } from "@/host/port";
import type { SessionStore } from "@/octto/session";
import { createBrainstormTools } from "./brainstorm";
import { createPushQuestionTool } from "./factory";
import { createQuestionTools } from "./questions";
import { createResponseTools } from "./responses";
import { createSessionTools } from "./session";
import type { OcttoSessionTracker, OcttoTools } from "./types";

export type { SessionStore } from "@/octto/session";
export { createSessionStore } from "@/octto/session";
export type { OcttoSessionTracker, OcttoTools } from "./types";

export function createOcttoTools(
  sessions: SessionStore,
  host: SessionHost,
  workspace: Workspace,
  tracker?: OcttoSessionTracker,
): OcttoTools {
  return {
    ...createSessionTools(sessions, tracker),
    ...createQuestionTools(sessions),
    ...createResponseTools(sessions),
    ...createPushQuestionTool(sessions),
    ...createBrainstormTools(sessions, host, workspace, tracker),
  };
}
