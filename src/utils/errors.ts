// src/utils/errors.ts
// Unified error handling utilities
// Used by tools and hooks for consistent error formatting and logging

/**
 * Safely extract error message from unknown error type.
 * Handles Error instances, strings, and other types.
 */
export function extractErrorMessage(e: unknown): string {
  if (e instanceof Error) {
    return e.message;
  }
  return String(e);
}
