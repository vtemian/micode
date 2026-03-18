// src/config-schemas.ts
// Valibot schemas for micode.json and opencode.json config validation
import * as v from "valibot";

// --- micode.json schemas ---

const ThinkingSchema = v.object({
  type: v.string(),
  budgetTokens: v.number(),
});

const AgentOverrideSchema = v.object({
  model: v.optional(v.string()),
  temperature: v.optional(v.number()),
  maxTokens: v.optional(v.number()),
  thinking: v.optional(ThinkingSchema),
});

const MicodeFeaturesSchema = v.object({
  mindmodelInjection: v.optional(v.boolean()),
});

/**
 * Schema for the raw micode.json config file.
 * All fields are optional — users can provide any subset.
 * Uses passthrough() on nested objects to tolerate extra keys from user configs.
 */
export const RawMicodeConfigSchema = v.object({
  agents: v.optional(v.record(v.string(), v.unknown())),
  features: v.optional(
    v.pipe(
      v.record(v.string(), v.unknown()),
      v.transform((raw) => raw),
    ),
  ),
  compactionThreshold: v.optional(v.unknown()),
  fragments: v.optional(v.record(v.string(), v.unknown())),
});

// Safe properties that users can override in agent configs
const SAFE_AGENT_PROPERTIES = ["model", "temperature", "maxTokens", "thinking"] as const;

/**
 * Validate and sanitize an individual agent override.
 * Only picks safe properties; extra keys from user config are discarded.
 */
export function sanitizeAgentOverride(raw: unknown): v.InferOutput<typeof AgentOverrideSchema> | null {
  if (!raw || typeof raw !== "object") return null;

  const record = raw as Record<string, unknown>;
  const picked: Record<string, unknown> = {};
  for (const prop of SAFE_AGENT_PROPERTIES) {
    if (prop in record) {
      picked[prop] = record[prop];
    }
  }

  const result = v.safeParse(AgentOverrideSchema, picked);
  if (!result.success) return null;
  return result.output;
}

/**
 * Validate and sanitize the agents record from micode.json
 */
export function sanitizeAgentsRecord(
  raw: Record<string, unknown>,
): Record<string, v.InferOutput<typeof AgentOverrideSchema>> {
  const sanitized: Record<string, v.InferOutput<typeof AgentOverrideSchema>> = {};
  for (const [name, agentRaw] of Object.entries(raw)) {
    const override = sanitizeAgentOverride(agentRaw);
    if (override) sanitized[name] = override;
  }
  return sanitized;
}

/**
 * Validate features from micode.json
 */
export function sanitizeFeatures(raw: Record<string, unknown>): v.InferOutput<typeof MicodeFeaturesSchema> {
  const result = v.safeParse(MicodeFeaturesSchema, raw);
  if (!result.success) return {};
  return result.output;
}

/**
 * Validate compactionThreshold: must be a number between 0 and 1 inclusive
 */
const CompactionThresholdSchema = v.pipe(v.number(), v.minValue(0), v.maxValue(1));

export function sanitizeCompactionThreshold(raw: unknown): number | undefined {
  const result = v.safeParse(CompactionThresholdSchema, raw);
  if (!result.success) return undefined;
  return result.output;
}

/**
 * Validate fragments: Record<string, string[]> where strings must be non-empty
 */
const FragmentArraySchema = v.pipe(
  v.array(v.string()),
  v.transform((arr) => arr.filter((s) => s.trim().length > 0)),
);

export function sanitizeFragments(raw: Record<string, unknown>): Record<string, string[]> {
  const sanitized: Record<string, string[]> = {};
  for (const [name, fragments] of Object.entries(raw)) {
    if (!Array.isArray(fragments)) continue;
    // Filter to only strings first, then validate
    const strings = fragments.filter((f): f is string => typeof f === "string");
    const result = v.safeParse(FragmentArraySchema, strings);
    if (result.success && result.output.length > 0) {
      sanitized[name] = result.output;
    }
  }
  return sanitized;
}

// --- opencode.json schemas ---

const ModelLimitSchema = v.object({
  context: v.optional(v.number()),
});

const ModelConfigSchema = v.object({
  limit: v.optional(ModelLimitSchema),
});

const ProviderConfigSchema = v.object({
  models: v.optional(v.record(v.string(), v.unknown())),
});

export const OpencodeConfigSchema = v.object({
  model: v.optional(v.string()),
  provider: v.optional(v.record(v.string(), v.unknown())),
});

/**
 * Validate and extract provider models from opencode.json
 */
export function extractProviderModels(providerRaw: Record<string, unknown>): Set<string> {
  const models = new Set<string>();
  for (const [providerId, providerConfig] of Object.entries(providerRaw)) {
    const parsed = v.safeParse(ProviderConfigSchema, providerConfig);
    if (!parsed.success || !parsed.output.models) continue;
    for (const modelId of Object.keys(parsed.output.models)) {
      models.add(`${providerId}/${modelId}`);
    }
  }
  return models;
}

/**
 * Extract context limit from a single model config entry
 */
function extractModelContextLimit(modelRaw: unknown): number | null {
  const modelParsed = v.safeParse(ModelConfigSchema, modelRaw);
  if (!modelParsed.success) return null;
  const contextLimit = modelParsed.output.limit?.context;
  if (typeof contextLimit === "number" && contextLimit > 0) return contextLimit;
  return null;
}

/**
 * Collect context limits from all models within a single provider
 */
function collectProviderContextLimits(
  providerId: string,
  models: Record<string, unknown>,
  limits: Map<string, number>,
): void {
  for (const [modelId, modelRaw] of Object.entries(models)) {
    const contextLimit = extractModelContextLimit(modelRaw);
    if (contextLimit !== null) {
      limits.set(`${providerId}/${modelId}`, contextLimit);
    }
  }
}

/**
 * Validate and extract context limits from opencode.json provider config
 */
export function extractContextLimits(providerRaw: Record<string, unknown>): Map<string, number> {
  const limits = new Map<string, number>();
  for (const [providerId, providerConfig] of Object.entries(providerRaw)) {
    const providerParsed = v.safeParse(ProviderConfigSchema, providerConfig);
    if (!providerParsed.success || !providerParsed.output.models) continue;
    collectProviderContextLimits(providerId, providerParsed.output.models, limits);
  }
  return limits;
}
