// src/tools/pty/buffer.ts
import type { SearchMatch } from "./types";

const FALLBACK_MAX_BUFFER_LINES = 50_000;
const parsed = parseInt(process.env.PTY_MAX_BUFFER_LINES || String(FALLBACK_MAX_BUFFER_LINES), 10);
const DEFAULT_MAX_LINES = Number.isNaN(parsed) ? FALLBACK_MAX_BUFFER_LINES : parsed;

export class RingBuffer {
  private lines: string[] = [];
  private readonly maxLines: number;

  constructor(maxLines: number = DEFAULT_MAX_LINES) {
    this.maxLines = maxLines;
  }

  append(data: string): void {
    const newLines = data.split("\n");
    for (const line of newLines) {
      this.lines.push(line);
      if (this.lines.length > this.maxLines) {
        this.lines.shift();
      }
    }
  }

  read(offset: number = 0, limit?: number): string[] {
    const start = Math.max(0, offset);
    const end = limit !== undefined ? start + limit : this.lines.length;
    return this.lines.slice(start, end);
  }

  search(pattern: RegExp): SearchMatch[] {
    const matches: SearchMatch[] = [];
    for (let i = 0; i < this.lines.length; i++) {
      const line = this.lines[i];
      if (line !== undefined && pattern.test(line)) {
        matches.push({ lineNumber: i + 1, text: line });
      }
    }
    return matches;
  }

  get length(): number {
    return this.lines.length;
  }

  clear(): void {
    this.lines = [];
  }
}
