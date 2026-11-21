// src/tools/pty/types.ts
import type { RingBuffer } from "./buffer"; // now a ReturnType alias

export type PTYStatus = "running" | "exited" | "killed";

export interface PTYSession {
  readonly id: string;
  readonly title: string;
  readonly command: string;
  readonly args: string[];
  readonly workdir: string;
  readonly env?: Record<string, string>;
  status: PTYStatus;
  exitCode?: number;
  readonly pid: number;
  readonly createdAt: Date;
  readonly parentSessionId?: string;
  readonly buffer: RingBuffer;
  readonly process: import("bun-pty").IPty;
}

export interface PTYSessionInfo {
  readonly id: string;
  readonly title: string;
  readonly command: string;
  readonly args: string[];
  readonly workdir: string;
  readonly status: PTYStatus;
  readonly exitCode?: number;
  readonly pid: number;
  readonly createdAt: Date;
  readonly lineCount: number;
}

export interface SpawnOptions {
  readonly command: string;
  readonly args?: string[];
  readonly workdir?: string;
  readonly env?: Record<string, string>;
  readonly title?: string;
  readonly parentSessionId?: string;
}

export interface ReadResult {
  readonly lines: string[];
  readonly totalLines: number;
  readonly offset: number;
  readonly hasMore: boolean;
}

export interface SearchMatch {
  readonly lineNumber: number;
  readonly text: string;
}

export interface SearchResult {
  readonly matches: SearchMatch[];
  readonly totalMatches: number;
  readonly totalLines: number;
  readonly offset: number;
  readonly hasMore: boolean;
}
