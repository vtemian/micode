// tests/helpers/log-capture.ts
import { spyOn } from "bun:test";

/**
 * Console output collected while a test runs.
 *
 * Tests that intentionally drive production code down a logging path use this
 * to keep the reporter output pristine while still asserting on what was
 * logged. Multi-argument calls are joined with a single space.
 */
export interface LogCapture {
  readonly info: string[];
  readonly warn: string[];
  readonly error: string[];
  restore: () => void;
}

const format = (args: unknown[]): string => args.map((arg) => String(arg)).join(" ");

export function captureLogs(): LogCapture {
  const info: string[] = [];
  const warn: string[] = [];
  const error: string[] = [];

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
    info,
    warn,
    error,
    restore: () => {
      for (const spy of spies) {
        spy.mockRestore();
      }
    },
  };
}
