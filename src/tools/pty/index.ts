// src/tools/pty/index.ts

export { RingBuffer } from "./buffer";
export { PTYManager } from "./manager";
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

import type { PTYManager } from "./manager";
import { createPtyKillTool } from "./tools/kill";
import { createPtyListTool } from "./tools/list";
import { createPtyReadTool } from "./tools/read";
import { createPtySpawnTool } from "./tools/spawn";
import { createPtyWriteTool } from "./tools/write";

export function createPtyTools(manager: PTYManager) {
  return {
    pty_spawn: createPtySpawnTool(manager),
    pty_write: createPtyWriteTool(manager),
    pty_read: createPtyReadTool(manager),
    pty_list: createPtyListTool(manager),
    pty_kill: createPtyKillTool(manager),
  };
}
