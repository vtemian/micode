// src/tools/pty/index.ts

export { createRingBuffer, type RingBuffer } from "./buffer";
export { createPTYManager, type PTYManager } from "./manager";
export { getBunPtyLoadError, isBunPtyAvailable, loadBunPty } from "./pty-loader";
export { createPtyKillTool } from "./tools/kill";
export { createPtyListTool } from "./tools/list";
export { createPtyReadTool } from "./tools/read";
export { createPtySpawnTool } from "./tools/spawn";
export { createPtyWriteTool } from "./tools/write";
export type {
  PTYSession,
  PTYSessionInfo,
  PTYStatus,
  ReadResult,
  SearchMatch,
  SearchResult,
  SpawnOptions,
} from "./types";

import type { Workspace } from "@/host/port";
import type { MicodeTools } from "@/tools/define";
import type { PTYManager } from "./manager"; // now a ReturnType alias
import { createPtyKillTool } from "./tools/kill";
import { createPtyListTool } from "./tools/list";
import { createPtyReadTool } from "./tools/read";
import { createPtySpawnTool } from "./tools/spawn";
import { createPtyWriteTool } from "./tools/write";

export function createPtyTools(manager: PTYManager, workspace: Workspace): MicodeTools {
  return {
    pty_spawn: createPtySpawnTool(manager, workspace),
    pty_write: createPtyWriteTool(manager),
    pty_read: createPtyReadTool(manager),
    pty_list: createPtyListTool(manager),
    pty_kill: createPtyKillTool(manager),
  };
}
