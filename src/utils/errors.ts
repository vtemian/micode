// src/utils/errors.ts
// Unified error handling utilities
// Used by tools and hooks for consistent error formatting and logging

function messageOf(candidate: unknown): string | undefined {
  if (typeof candidate !== "object" || candidate === null) return undefined;
  const message = (candidate as { message?: unknown }).message;
  return typeof message === "string" ? message : undefined;
}

/**
 * Safely extract error message from unknown error type.
 * Handles Error instances, strings, plain `{ message }` objects and the
 * OpenCode SDK's `{ name, data: { message } }` error payloads.
 */
export function extractErrorMessage(e: unknown): string {
  if (e instanceof Error) {
    return e.message;
  }
  const direct = messageOf(e);
  if (direct !== undefined) return direct;
  const nested = messageOf((e as { data?: unknown } | null)?.data);
  if (nested !== undefined) return nested;
  return String(e);
}
