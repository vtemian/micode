// src/config-loader.ts
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import type { AgentConfig } from "@opencode-ai/sdk";

// Minimal type for provider validation - only what we need
export interface ProviderInfo {
  id: string;
  models: Record<string, unknown>;
}

/**
 * Load available models from opencode.json config file (synchronous)
 * Returns a Set of "provider/model" strings
 */
export function loadAvailableModels(configDir?: string): Set<string> {
  const availableModels = new Set<string>();
  const baseDir = configDir ?? join(homedir(), ".config", "opencode");

  try {
    const configPath = join(baseDir, "opencode.json");
    const content = readFileSync(configPath, "utf-8");
    const config = JSON.parse(content) as { provider?: Record<string, { models?: Record<string, unknown> }> };

    if (config.provider) {
      for (const [providerId, providerConfig] of Object.entries(config.provider)) {
        if (providerConfig.models) {
          for (const modelId of Object.keys(providerConfig.models)) {
            availableModels.add(`${providerId}/${modelId}`);
          }
        }
      }
    }
  } catch {
    // Config doesn't exist or can't be parsed - return empty set
  }

  return availableModels;
}

// Safe properties that users can override
const SAFE_AGENT_PROPERTIES = ["model", "temperature", "maxTokens"] as const;

export interface AgentOverride {
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface MicodeConfig {
  agents?: Record<string, AgentOverride>;
}

/**
 * Load micode.json from ~/.config/opencode/micode.json
 * Returns null if file doesn't exist or is invalid JSON
 * @param configDir - Optional override for config directory (for testing)
 */
export async function loadMicodeConfig(configDir?: string): Promise<MicodeConfig | null> {
  const baseDir = configDir ?? join(homedir(), ".config", "opencode");
  const configPath = join(baseDir, "micode.json");

  try {
    const content = await readFile(configPath, "utf-8");
    const parsed = JSON.parse(content) as Record<string, unknown>;

    // Sanitize the config - only allow safe properties
    if (parsed.agents && typeof parsed.agents === "object") {
      const sanitizedAgents: Record<string, AgentOverride> = {};

      for (const [agentName, agentConfig] of Object.entries(parsed.agents)) {
        if (agentConfig && typeof agentConfig === "object") {
          const sanitized: AgentOverride = {};
          const config = agentConfig as Record<string, unknown>;

          for (const prop of SAFE_AGENT_PROPERTIES) {
            if (prop in config) {
              (sanitized as Record<string, unknown>)[prop] = config[prop];
            }
          }

          sanitizedAgents[agentName] = sanitized;
        }
      }

      return { agents: sanitizedAgents };
    }

    return parsed as MicodeConfig;
  } catch {
    return null;
  }
}

/**
 * Merge user config overrides into plugin agent configs
 * Model overrides are validated against available models from opencode.json
 * Invalid models are logged and skipped (agent uses opencode default)
 */
export function mergeAgentConfigs(
  pluginAgents: Record<string, AgentConfig>,
  userConfig: MicodeConfig | null,
  availableModels?: Set<string>,
): Record<string, AgentConfig> {
  if (!userConfig?.agents) {
    return pluginAgents;
  }

  // Load available models if not provided
  const models = availableModels ?? loadAvailableModels();

  const merged: Record<string, AgentConfig> = {};

  for (const [name, agentConfig] of Object.entries(pluginAgents)) {
    const userOverride = userConfig.agents[name];

    if (userOverride) {
      // Validate model if specified
      if (userOverride.model) {
        if (models.has(userOverride.model)) {
          // Model is valid - apply all overrides
          merged[name] = {
            ...agentConfig,
            ...userOverride,
          };
        } else {
          // Model is invalid - log warning and apply other overrides only
          console.warn(
            `[micode] Model "${userOverride.model}" for agent "${name}" is not available. Using opencode default.`,
          );
          const { model: _ignored, ...safeOverrides } = userOverride;
          merged[name] = {
            ...agentConfig,
            ...safeOverrides,
          };
        }
      } else {
        // No model specified - apply all overrides
        merged[name] = {
          ...agentConfig,
          ...userOverride,
        };
      }
    } else {
      merged[name] = agentConfig;
    }
  }

  return merged;
}

/**
 * Validate that configured models exist in available providers
 * Removes invalid model overrides and logs warnings
 */
export function validateAgentModels(userConfig: MicodeConfig, providers: ProviderInfo[]): MicodeConfig {
  if (!userConfig.agents) {
    return userConfig;
  }

  const hasAnyModels = providers.some((provider) => Object.keys(provider.models).length > 0);
  if (!hasAnyModels) {
    return userConfig;
  }

  // Build lookup map for providers and their models
  const providerMap = new Map<string, Set<string>>();
  for (const provider of providers) {
    providerMap.set(provider.id, new Set(Object.keys(provider.models)));
  }

  const validatedAgents: Record<string, AgentOverride> = {};

  for (const [agentName, override] of Object.entries(userConfig.agents)) {
    // No model specified - keep other properties as-is
    if (override.model === undefined) {
      validatedAgents[agentName] = override;
      continue;
    }

    // Empty or whitespace-only model - treat as invalid
    const trimmedModel = override.model.trim();
    if (!trimmedModel) {
      const { model: _removed, ...otherProps } = override;
      console.warn(`[micode] Empty model for agent "${agentName}". Using default model.`);
      if (Object.keys(otherProps).length > 0) {
        validatedAgents[agentName] = otherProps;
      }
      continue;
    }

    // Parse "provider/model" format
    const [providerID, ...rest] = trimmedModel.split("/");
    const modelID = rest.join("/");

    const providerModels = providerMap.get(providerID);
    const isValid = providerModels?.has(modelID) ?? false;

    if (isValid) {
      validatedAgents[agentName] = override;
    } else {
      // Remove invalid model but keep other properties
      const { model: _removed, ...otherProps } = override;
      console.warn(`[micode] Model "${override.model}" not found for agent "${agentName}". Using default model.`);
      if (Object.keys(otherProps).length > 0) {
        validatedAgents[agentName] = otherProps;
      }
    }
  }

  return { agents: validatedAgents };
}
