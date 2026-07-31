// tests/helpers/log-capture.ts
import { spyOn } from "bun:test";

/**
 * Console output collected while a test runs.
 *
 * Tests that intentionally drive production code down a logging path use this
 * to keep the reporter output pristine while still asserting on what was
 * logged. Multi-argument calls are joined with a single space.
 *
 * Reading a channel marks it inspected. `unread()` then reports anything the
 * test silently swallowed, so capturing cannot quietly become suppression:
 * pair it with an afterEach that fails on a non-empty result.
 */
export interface LogCapture {
  readonly info: string[];
  readonly warn: string[];
  readonly error: string[];
  /** Captured lines on channels the test never looked at. */
  unread: () => string[];
  restore: () => void;
}

const format = (args: unknown[]): string => args.map((arg) => String(arg)).join(" ");

export function captureLogs(): LogCapture {
  const info: string[] = [];
  const warn: string[] = [];
  const error: string[] = [];
  const inspected = new Set<string>();

  const channel = (name: string, lines: string[]): string[] => {
    inspected.add(name);
    return lines;
  };

  const spies = [
    spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      info.push(format(args));
    }),
    spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
      warn.push(format(args));
    }),
    spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      error.push(format(args));
    }),
  ];

  return {
    get info() {
      return channel("info", info);
    },
    get warn() {
      return channel("warn", warn);
    },
    get error() {
      return channel("error", error);
    },
    unread: () =>
      [
        ...(inspected.has("info") ? [] : info),
        ...(inspected.has("warn") ? [] : warn),
        ...(inspected.has("error") ? [] : error),
      ].filter(Boolean),
    restore: () => {
      for (const spy of spies) {
        spy.mockRestore();
      }
    },
  };
}
