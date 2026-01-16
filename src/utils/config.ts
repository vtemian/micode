// src/utils/config.ts
// Centralized configuration constants
// Organized by domain for easy discovery and maintenance

/**
 * Application configuration constants.
 * All values are compile-time constants - no runtime configuration.
 */
export const config = {
  /**
   * Auto-compaction settings
   */
  compaction: {
    /** Trigger compaction when context usage exceeds this ratio */
    threshold: 0.5,
    /** Minimum time between compaction attempts (ms) */
    cooldownMs: 30_000,
    /** Maximum time to wait for compaction to complete (ms) */
    timeoutMs: 120_000,
  },

  /**
   * Context window monitoring settings
   */
  contextWindow: {
    /** Show warning when context usage exceeds this ratio */
    warningThreshold: 0.7,
    /** Show critical warning when context usage exceeds this ratio */
    criticalThreshold: 0.85,
    /** Minimum time between warning toasts (ms) */
    warningCooldownMs: 120_000,
  },

  /**
   * Token estimation settings
   */
  tokens: {
    /** Characters per token for estimation */
    charsPerToken: 4,
    /** Default context window limit (tokens) */
    defaultContextLimit: 200_000,
    /** Default max output tokens */
    defaultMaxOutputTokens: 50_000,
    /** Safety margin for output (ratio of remaining context) */
    safetyMargin: 0.5,
    /** Lines to preserve when truncating output */
    preserveHeaderLines: 3,
  },

  /**
   * File path patterns and directories
   */
  paths: {
    /** Directory for ledger files */
    ledgerDir: "thoughts/ledgers",
    /** Prefix for ledger filenames */
    ledgerPrefix: "CONTINUITY_",
    /** Context files to inject from project root */
    rootContextFiles: ["ARCHITECTURE.md", "CODE_STYLE.md", "README.md"] as readonly string[],
    /** Context files to collect when walking up directories */
    dirContextFiles: ["README.md"] as readonly string[],
    /** Pattern to match plan files */
    planPattern: /thoughts\/shared\/plans\/.*\.md$/,
    /** Pattern to match ledger files */
    ledgerPattern: /thoughts\/ledgers\/CONTINUITY_.*\.md$/,
  },

  /**
   * Timeout settings
   */
  timeouts: {
    /** BTCA command timeout (ms) */
    btcaMs: 120_000,
    /** Success toast duration (ms) */
    toastSuccessMs: 3000,
    /** Warning toast duration (ms) */
    toastWarningMs: 4000,
    /** Error toast duration (ms) */
    toastErrorMs: 5000,
  },

  /**
   * Various limits
   */
  limits: {
    /** File size threshold for triggering extraction (bytes) */
    largeFileBytes: 100 * 1024,
    /** Max lines to return without extraction */
    maxLinesNoExtract: 200,
    /** Max lines in PTY buffer */
    ptyMaxBufferLines: 50_000,
    /** Default read limit for PTY */
    ptyDefaultReadLimit: 500,
    /** Max line length for PTY output */
    ptyMaxLineLength: 2000,
    /** Max matches to show from ast-grep */
    astGrepMaxMatches: 100,
    /** Context cache TTL (ms) */
    contextCacheTtlMs: 30_000,
    /** Max entries in context cache */
    contextCacheMaxSize: 100,
  },
} as const;
