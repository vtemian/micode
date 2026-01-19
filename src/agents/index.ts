import type { AgentConfig } from "@opencode-ai/sdk";

import { artifactSearcherAgent } from "./artifact-searcher";
import { bootstrapperAgent } from "./bootstrapper";
import { brainstormerAgent } from "./brainstormer";
import { codebaseAnalyzerAgent } from "./codebase-analyzer";
import { codebaseLocatorAgent } from "./codebase-locator";
import { PRIMARY_AGENT_NAME, primaryAgent } from "./commander";
import { executorAgent } from "./executor";
import { implementerAgent } from "./implementer";
import { ledgerCreatorAgent } from "./ledger-creator";
import {
  exampleExtractorAgent,
  mindmodelOrchestratorAgent,
  mindmodelPatternDiscovererAgent,
  stackDetectorAgent,
} from "./mindmodel";
import { octtoAgent } from "./octto";
import { patternFinderAgent } from "./pattern-finder";
import { plannerAgent } from "./planner";
import { probeAgent } from "./probe";
import { projectInitializerAgent } from "./project-initializer";
import { reviewerAgent } from "./reviewer";

export const agents: Record<string, AgentConfig> = {
  [PRIMARY_AGENT_NAME]: { ...primaryAgent, model: "openai/gpt-5.2-codex" },
  brainstormer: { ...brainstormerAgent, model: "openai/gpt-5.2-codex" },
  bootstrapper: { ...bootstrapperAgent, model: "openai/gpt-5.2-codex" },
  "codebase-locator": { ...codebaseLocatorAgent, model: "openai/gpt-5.2-codex" },
  "codebase-analyzer": { ...codebaseAnalyzerAgent, model: "openai/gpt-5.2-codex" },
  "pattern-finder": { ...patternFinderAgent, model: "openai/gpt-5.2-codex" },
  planner: { ...plannerAgent, model: "openai/gpt-5.2-codex" },
  implementer: { ...implementerAgent, model: "openai/gpt-5.2-codex" },
  reviewer: { ...reviewerAgent, model: "openai/gpt-5.2-codex" },
  executor: { ...executorAgent, model: "openai/gpt-5.2-codex" },
  "project-initializer": { ...projectInitializerAgent, model: "openai/gpt-5.2-codex" },
  "ledger-creator": { ...ledgerCreatorAgent, model: "openai/gpt-5.2-codex" },
  "artifact-searcher": { ...artifactSearcherAgent, model: "openai/gpt-5.2-codex" },
  octto: { ...octtoAgent, model: "openai/gpt-5.2-codex" },
  probe: { ...probeAgent, model: "openai/gpt-5.2-codex" },
  // Mindmodel generation agents
  "mm-stack-detector": { ...stackDetectorAgent, model: "openai/gpt-5.2-codex" },
  "mm-pattern-discoverer": { ...mindmodelPatternDiscovererAgent, model: "openai/gpt-5.2-codex" },
  "mm-example-extractor": { ...exampleExtractorAgent, model: "openai/gpt-5.2-codex" },
  "mm-orchestrator": { ...mindmodelOrchestratorAgent, model: "openai/gpt-5.2-codex" },
};

export {
  primaryAgent,
  PRIMARY_AGENT_NAME,
  brainstormerAgent,
  bootstrapperAgent,
  codebaseLocatorAgent,
  codebaseAnalyzerAgent,
  patternFinderAgent,
  plannerAgent,
  implementerAgent,
  reviewerAgent,
  executorAgent,
  projectInitializerAgent,
  ledgerCreatorAgent,
  artifactSearcherAgent,
  octtoAgent,
  probeAgent,
};
