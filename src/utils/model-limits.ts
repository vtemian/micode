// Shared model context limits (tokens)
// Used by context-window-monitor and auto-clear-ledger hooks

export const MODEL_CONTEXT_LIMITS: Record<string, number> = {
  // Claude models
  "claude-opus": 200_000,
  "claude-sonnet": 200_000,
  "claude-haiku": 200_000,
  "claude-3": 200_000,
  "claude-4": 200_000,
  // OpenAI models
  "gpt-4o": 128_000,
  "gpt-4-turbo": 128_000,
  "gpt-4": 128_000,
  "gpt-5": 200_000,
  o1: 200_000,
  o3: 200_000,
  // Google models
  gemini: 1_000_000,
};

export const DEFAULT_CONTEXT_LIMIT = 200_000;

/**
 * Get the context window limit for a given model ID.
 * Matches against known patterns and falls back to default.
 */
export function getContextLimit(modelID: string): number {
  const modelLower = modelID.toLowerCase();
  for (const [pattern, limit] of Object.entries(MODEL_CONTEXT_LIMITS)) {
    if (modelLower.includes(pattern)) {
      return limit;
    }
  }
  return DEFAULT_CONTEXT_LIMIT;
}
