// src/config-loader.ts
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import type { AgentConfig } from "@opencode-ai/sdk";
import { type ParseError, parse as parseJsonc } from "jsonc-parser";
import * as v from "valibot";
import {
  extractContextLimits,
  extractProviderIds,
  extractProviderModels,
  parseModelSelection,
  parseProviderRecord,
  RawMicodeConfigSchema,
  sanitizeAgentsRecord,
  sanitizeCompactionThreshold,
  sanitizeFeatures,
  sanitizeFragments,
} from "@/config-schemas";
import { extractErrorMessage } from "@/utils/errors";
import { log } from "@/utils/logger";

const LOG_MODULE = "config-loader";

// Minimal type for provider validation - only what we need
export interface ProviderInfo {
  readonly id: string;
  readonly models: Record<string, unknown>;
}

/** The fields micode reads from opencode.json/opencode.jsonc, each validated on its own. */
export interface OpencodeSettings {
  /** Default model as "provider/model". */
  readonly model?: string;
  /** Variant of the default model (the part after "#", or the object form's `variant`). */
  readonly variant?: string;
  readonly provider?: Record<string, unknown>;
  /** Problems found while reading; the affected file or field was skipped. */
  readonly warnings: readonly string[];
}

// Later files win per top-level key, matching OpenCode's own load order.
const OPENCODE_CONFIG_FILES = ["opencode.json", "opencode.jsonc"] as const;

function defaultConfigDir(): string {
  return join(homedir(), ".config", "opencode");
}

/**
 * Parse a JSON or JSONC string, supporting comments and trailing commas.
 * Uses the same options as OpenCode's own parser.
 */
function parseConfigJson(content: string): unknown {
  const errors: ParseError[] = [];
  const parsed: unknown = parseJsonc(content.replace(/^\uFEFF/u, ""), errors, { allowTrailingComma: true });
  if (errors.length > 0) {
    throw new Error(`Invalid JSON/JSONC: ${errors.length} parse error(s)`);
  }
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readConfigObject(baseDir: string, file: string, warnings: string[]): Record<string, unknown> {
  let content: string;
  try {
    content = readFileSync(join(baseDir, file), "utf-8");
  } catch {
    // A missing file is normal; either name may be absent.
    return {};
  }
  try {
    const raw = parseConfigJson(content);
    if (isRecord(raw)) return raw;
    warnings.push(`${file}: expected a JSON object; ignoring the file`);
  } catch (error) {
    warnings.push(`${file}: ${extractErrorMessage(error)}; ignoring the file`);
  }
  return {};
}

/**
 * Read opencode.json and opencode.jsonc (jsonc wins per key) and validate each field separately,
 * so one malformed field or file never discards the rest.
 */
export function loadOpencodeSettings(configDir?: string): OpencodeSettings {
  const baseDir = configDir ?? defaultConfigDir();
  const warnings: string[] = [];
  const merged: Record<string, unknown> = {};
  for (const file of OPENCODE_CONFIG_FILES) Object.assign(merged, readConfigObject(baseDir, file, warnings));
  const selection = parseField(merged.model, parseModelSelection, warnings, "model is not a provider/model ref");
  const legacy = parseField(merged.provider, parseProviderRecord, warnings, "provider must be an object");
  const native = parseField(merged.providers, parseProviderRecord, warnings, "providers must be an object");
  // OpenCode 2 reads both keys; its native `providers` wins on conflict.
  const provider = legacy || native ? { ...legacy, ...native } : undefined;
  return { model: selection?.ref, variant: selection?.variant, provider, warnings };
}

function parseField<T>(
  raw: unknown,
  parse: (raw: unknown) => T | undefined,
  warnings: string[],
  problem: string,
): T | undefined {
  if (raw === undefined) return undefined;
  const parsed = parse(raw);
  if (parsed === undefined) warnings.push(`${problem} (${JSON.stringify(raw)}); ignoring it`);
  return parsed;
}

/**
 * Read a config file, preferring .jsonc over .json (async).
 * Returns the file content string, or null if neither file exists.
 */
async function readConfigFileAsync(baseDir: string, baseName: string): Promise<string | null> {
  try {
    return await readFile(join(baseDir, `${baseName}.jsonc`), "utf-8");
  } catch {
    // .jsonc not found, try .json
  }

  try {
    return await readFile(join(baseDir, `${baseName}.json`), "utf-8");
  } catch {
    // Neither file exists; the caller treats null as "no config".
    return null;
  }
}

/**
 * Load available models from opencode.json/opencode.jsonc config file (synchronous)
 * Returns a Set of "provider/model" strings
 */
export function loadAvailableModels(configDir?: string): Set<string> {
  const { provider } = loadOpencodeSettings(configDir);
  return provider ? extractProviderModels(provider) : new Set<string>();
}

/**
 * Load the default model from opencode.json/opencode.jsonc config file (synchronous)
 * Returns the model string in "provider/model" format or null if not set
 */
export function loadDefaultModel(configDir?: string): string | null {
  return loadOpencodeSettings(configDir).model ?? null;
}

/**
 * Provider ids configured in opencode.json, with or without declared models.
 * A configured provider serves its whole runtime registry (openai,
 * github-copilot, ...), not just the models the file happens to list.
 */
export function loadConfiguredProviders(configDir?: string): Set<string> {
  const { provider } = loadOpencodeSettings(configDir);
  return provider ? extractProviderIds(provider) : new Set<string>();
}

// Built-in OpenCode models that don't require validation (always available)
const BUILTIN_MODELS = new Set(["opencode/big-pickle"]);

export interface AgentOverride {
  readonly model?: string;
  readonly variant?: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly steps?: number;
  readonly maxSteps?: number;
  readonly thinking?: {
    readonly type: string;
    readonly budgetTokens: number;
  };
}

export interface MicodeFeatures {
  readonly mindmodelInjection?: boolean;
  /** Set false when context7 is already provided by another tool or proxy. */
  readonly context7?: boolean;
}

export interface MicodeConfig {
  agents?: Record<string, AgentOverride>;
  features?: MicodeFeatures;
  compactionThreshold?: number;
  fragments?: Record<string, string[]>;
}

/**
 * Load micode.json/micode.jsonc from ~/.config/opencode/
 * Returns null if file doesn't exist or is invalid
 * @param configDir - Optional override for config directory (for testing)
 */
export async function loadMicodeConfig(configDir?: string): Promise<MicodeConfig | null> {
  const baseDir = configDir ?? defaultConfigDir();

  try {
    const content = await readConfigFileAsync(baseDir, "micode");
    if (!content) return null;

    const raw = parseConfigJson(content);
    return buildMicodeConfig(raw);
  } catch {
    return null;
  }
}

function buildMicodeConfig(raw: unknown): MicodeConfig {
  const parsed = v.safeParse(RawMicodeConfigSchema, raw);
  if (!parsed.success) return {};

  const config = parsed.output;
  const micodeConfig: MicodeConfig = {};

  if (config.agents) {
    const warnings: string[] = [];
    micodeConfig.agents = sanitizeAgentsRecord(config.agents, warnings);
    for (const warning of warnings) log.warn(LOG_MODULE, warning);
  }

  if (config.features && typeof config.features === "object") {
    micodeConfig.features = sanitizeFeatures(config.features);
  }

  const threshold = sanitizeCompactionThreshold(config.compactionThreshold);
  if (threshold !== undefined) {
    micodeConfig.compactionThreshold = threshold;
  }

  if (config.fragments) {
    micodeConfig.fragments = sanitizeFragments(config.fragments);
  }

  return micodeConfig;
}

/**
 * Load model context limits from opencode.json/opencode.jsonc
 * Returns a Map of "provider/model" -> context limit (tokens)
 */
export function loadModelContextLimits(configDir?: string): Map<string, number> {
  const { provider } = loadOpencodeSettings(configDir);
  return provider ? extractContextLimits(provider) : new Map<string, number>();
}

/**
 * Merge user config overrides into plugin agent configs
 * Model overrides are validated against available models from opencode.json
 * Invalid models are logged and skipped (agent uses opencode default)
 *
 * Model resolution priority:
 * 1. Per-agent override in micode.json (highest)
 * 2. Default model from opencode.json "model" field
 * 3. DEFAULT_MODEL from config (plugin fallback)
 */
export function mergeAgentConfigs(
  pluginAgents: Record<string, AgentConfig>,
  userConfig: MicodeConfig | null,
  availableModels?: Set<string>,
  defaultModel?: string | null,
  configuredProviders?: Set<string>,
  defaultVariant?: string | null,
): Record<string, AgentConfig> {
  const models = availableModels ?? loadAvailableModels();
  // Injected models without injected providers means a test pinning the exact
  // model list; production loads both from the same config file.
  const providers = configuredProviders ?? (availableModels ? new Set<string>() : loadConfiguredProviders());
  const shouldValidateModels = models.size > 0 || providers.size > 0;
  const settings = defaultModel === undefined ? loadOpencodeSettings() : undefined;
  const opencodeDefaultModel = defaultModel === undefined ? (settings?.model ?? null) : defaultModel;
  const opencodeDefaultVariant = defaultVariant === undefined ? (settings?.variant ?? null) : defaultVariant;

  const isValidModel = (model: string): boolean => {
    if (BUILTIN_MODELS.has(model)) return true;
    if (!shouldValidateModels) return true;
    if (models.has(model)) return true;
    // Registry-backed providers serve more models than the config file
    // declares; a configured provider can resolve the rest at runtime (#48).
    const providerId = model.slice(0, model.indexOf("/"));
    return model.includes("/") && providers.has(providerId);
  };

  const merged: Record<string, AgentConfig> = {};

  for (const [name, agentConfig] of Object.entries(pluginAgents)) {
    const defaults = { model: opencodeDefaultModel, variant: opencodeDefaultVariant };
    merged[name] = mergeOneAgent(agentConfig, userConfig?.agents?.[name], name, defaults, isValidModel);
  }

  return merged;
}

interface DefaultModel {
  readonly model: string | null;
  readonly variant: string | null;
}

function mergeOneAgent(
  agentConfig: AgentConfig,
  userOverride: AgentOverride | undefined,
  name: string,
  defaults: DefaultModel,
  isValidModel: (model: string) => boolean,
): AgentConfig {
  let finalConfig: AgentConfig = { ...agentConfig };

  // Apply opencode default model if available and valid (overrides plugin default)
  if (defaults.model && isValidModel(defaults.model)) {
    finalConfig = { ...finalConfig, model: defaults.model };
    if (defaults.variant) finalConfig = { ...finalConfig, variant: defaults.variant };
  }

  if (!userOverride) return finalConfig;

  return applyUserOverride(finalConfig, userOverride, name, isValidModel);
}

function applyUserOverride(
  config: AgentConfig,
  override: AgentOverride,
  name: string,
  isValidModel: (model: string) => boolean,
): AgentConfig {
  if (!override.model) {
    return { ...config, ...override };
  }

  if (isValidModel(override.model)) {
    // The default model's variant belongs to that model, not to the override's.
    const { variant: _inherited, ...rest } = config;
    return { ...rest, ...override };
  }

  // Model is invalid - log warning and apply other overrides only
  const fallbackModel = config.model || "DEFAULT_MODEL";
  log.warn(LOG_MODULE, `Model "${override.model}" for agent "${name}" is not available. Using ${fallbackModel}.`);
  const { model: _ignored, ...safeOverrides } = override;
  return { ...config, ...safeOverrides };
}

/**
 * Validate that configured models exist in available providers
 * Removes invalid model overrides and logs warnings
 */
export function validateAgentModels(userConfig: MicodeConfig, providers: ProviderInfo[]): MicodeConfig {
  if (!userConfig.agents) return userConfig;

  const hasAnyModels = providers.some((provider) => Object.keys(provider.models).length > 0);
  if (!hasAnyModels) return userConfig;

  const modelsByProvider = buildProviders(providers);
  const validatedAgents: Record<string, AgentOverride> = {};

  for (const [agentName, override] of Object.entries(userConfig.agents)) {
    const validated = validateOneAgent(agentName, override, modelsByProvider);
    if (validated) validatedAgents[agentName] = validated;
  }

  return { agents: validatedAgents };
}

function buildProviders(providers: ProviderInfo[]): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  for (const provider of providers) {
    result.set(provider.id, new Set(Object.keys(provider.models)));
  }
  return result;
}

function validateOneAgent(
  agentName: string,
  override: AgentOverride,
  providers: Map<string, Set<string>>,
): AgentOverride | null {
  if (override.model === undefined) return override;

  const trimmedModel = override.model.trim();
  if (!trimmedModel) {
    log.warn(LOG_MODULE, `Empty model for agent "${agentName}". Using default model.`);
    return stripModel(override);
  }

  if (BUILTIN_MODELS.has(trimmedModel)) return override;

  const [providerID, ...rest] = trimmedModel.split("/");
  const modelID = rest.join("/");
  const providerModels = providers.get(providerID);
  const isValid = providerModels?.has(modelID) ?? false;

  if (isValid) return override;

  log.warn(LOG_MODULE, `Model "${override.model}" not found for agent "${agentName}". Using default model.`);
  return stripModel(override);
}

function stripModel(override: AgentOverride): AgentOverride | null {
  const { model: _removed, ...otherProps } = override;
  return Object.keys(otherProps).length > 0 ? otherProps : null;
}
