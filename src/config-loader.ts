// src/config-loader.ts
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import type { AgentConfig } from "@opencode-ai/sdk";
import { type ParseError, parse as parseJsonc } from "jsonc-parser";
import * as v from "valibot";
import {
  extractContextLimits,
  extractProviderModels,
  OpencodeConfigSchema,
  RawMicodeConfigSchema,
  sanitizeAgentsRecord,
  sanitizeCompactionThreshold,
  sanitizeFeatures,
  sanitizeFragments,
} from "@/config-schemas";
import { log } from "@/utils/logger";

const LOG_MODULE = "config-loader";

// Minimal type for provider validation - only what we need
export interface ProviderInfo {
  readonly id: string;
  readonly models: Record<string, unknown>;
}

/**
 * OpenCode config structure for reading default model and available models
 */
type OpencodeConfig = v.InferOutput<typeof OpencodeConfigSchema>;

/**
 * Parse a JSON or JSONC string, supporting comments and trailing commas.
 * Uses the same options as OpenCode's own parser.
 */
function parseConfigJson(content: string): unknown {
  const errors: ParseError[] = [];
  const parsed: unknown = parseJsonc(content, errors, { allowTrailingComma: true });
  if (errors.length > 0) {
    throw new Error(`Invalid JSON/JSONC: ${errors.length} parse error(s)`);
  }
  return parsed;
}

/**
 * Resolve a config file path, preferring .jsonc over .json (synchronous).
 * Returns the path to the first file found, or null if neither exists.
 */
function resolveConfigFileSync(baseDir: string, baseName: string): string | null {
  const jsoncPath = join(baseDir, `${baseName}.jsonc`);
  if (existsSync(jsoncPath)) {
    return jsoncPath;
  }

  const jsonPath = join(baseDir, `${baseName}.json`);
  if (existsSync(jsonPath)) {
    return jsonPath;
  }

  return null;
}

/**
 * Read a config file, preferring .jsonc over .json (async).
 * Returns the file content string, or null if neither file exists.
 */
async function readConfigFileAsync(baseDir: string, baseName: string): Promise<string | null> {
  // Try .jsonc first
  try {
    return await readFile(join(baseDir, `${baseName}.jsonc`), "utf-8");
  } catch {
    // .jsonc not found, try .json
  }

  try {
    return await readFile(join(baseDir, `${baseName}.json`), "utf-8");
  } catch {
    return null;
  }
}

/**
 * Load opencode.json/opencode.jsonc config file (synchronous)
 * Returns the parsed config or null if unavailable
 */
function loadOpencodeConfig(configDir?: string): OpencodeConfig | null {
  const baseDir = configDir ?? join(homedir(), ".config", "opencode");

  try {
    const configPath = resolveConfigFileSync(baseDir, "opencode");
    if (!configPath) return null;

    const content = readFileSync(configPath, "utf-8");
    const raw = parseConfigJson(content);
    const parsed = v.safeParse(OpencodeConfigSchema, raw);
    if (!parsed.success) return null;
    return parsed.output;
  } catch {
    return null;
  }
}

/**
 * Load available models from opencode.json/opencode.jsonc config file (synchronous)
 * Returns a Set of "provider/model" strings
 */
export function loadAvailableModels(configDir?: string): Set<string> {
  const config = loadOpencodeConfig(configDir);
  if (!config?.provider) return new Set<string>();
  return extractProviderModels(config.provider);
}

/**
 * Load the default model from opencode.json/opencode.jsonc config file (synchronous)
 * Returns the model string in "provider/model" format or null if not set
 */
export function loadDefaultModel(configDir?: string): string | null {
  const config = loadOpencodeConfig(configDir);
  return config?.model ?? null;
}

// Built-in OpenCode models that don't require validation (always available)
const BUILTIN_MODELS = new Set(["opencode/big-pickle"]);

export interface AgentOverride {
  readonly model?: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly thinking?: {
    readonly type: string;
    readonly budgetTokens: number;
  };
}

export interface MicodeFeatures {
  readonly mindmodelInjection?: boolean;
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
  const baseDir = configDir ?? join(homedir(), ".config", "opencode");

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
    micodeConfig.agents = sanitizeAgentsRecord(config.agents);
  }

  if (config.features && typeof config.features === "object") {
    micodeConfig.features = sanitizeFeatures(config.features as Record<string, unknown>);
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
  const config = loadOpencodeConfig(configDir);
  if (!config?.provider) return new Map<string, number>();
  return extractContextLimits(config.provider);
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
): Record<string, AgentConfig> {
  const models = availableModels ?? loadAvailableModels();
  const shouldValidateModels = models.size > 0;
  const opencodeDefaultModel = defaultModel !== undefined ? defaultModel : loadDefaultModel();

  const isValidModel = (model: string): boolean => {
    if (BUILTIN_MODELS.has(model)) return true;
    if (!shouldValidateModels) return true;
    return models.has(model);
  };

  const merged: Record<string, AgentConfig> = {};

  for (const [name, agentConfig] of Object.entries(pluginAgents)) {
    merged[name] = mergeOneAgent(agentConfig, userConfig?.agents?.[name], name, opencodeDefaultModel, isValidModel);
  }

  return merged;
}

function mergeOneAgent(
  agentConfig: AgentConfig,
  userOverride: AgentOverride | undefined,
  name: string,
  opencodeDefaultModel: string | null,
  isValidModel: (model: string) => boolean,
): AgentConfig {
  let finalConfig: AgentConfig = { ...agentConfig };

  // Apply opencode default model if available and valid (overrides plugin default)
  if (opencodeDefaultModel && isValidModel(opencodeDefaultModel)) {
    finalConfig = { ...finalConfig, model: opencodeDefaultModel };
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
    return { ...config, ...override };
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
