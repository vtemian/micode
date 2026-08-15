import type { AgentConfig } from "@opencode-ai/sdk";

import { DEFAULT_MODEL } from "@/utils/config";
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
  antiPatternDetectorAgent,
  codeClustererAgent,
  constraintReviewerAgent,
  constraintWriterAgent,
  conventionExtractorAgent,
  dependencyMapperAgent,
  domainExtractorAgent,
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

// Sensible default permissions so agents work out-of-the-box regardless of
// root-level permission denies in the user's opencode.json.  Each agent
// declares only the permissions it actually needs; values here match the
// tool restrictions already set in the individual agent files.
// See https://github.com/vtemian/micode/issues/52
const AGENT_PERMISSIONS = {
  // Read-only agents: locate files, analyze code, find patterns.
  // No explicit edit/bash deny needed — the agents' own `tools` config
  // already disables those tools, and omitting them here lets the global
  // permission config (edit: "allow", bash: "allow") apply.
  readOnly: {} as const,

  // Research agents: read-only + web access
  research: {
    webfetch: "allow",
  } as const,

  // Write agents: edit allowed
  write: {
    edit: "allow",
  } as const,

  // Build agents: edit + bash for tests
  build: {
    edit: "allow",
    bash: "allow",
  } as const,

  // Orchestration agents: full access including bash + web
  orchestration: {
    edit: "allow",
    bash: "allow",
    webfetch: "allow",
  } as const,
} as const;

export const agents: Record<string, AgentConfig> = {
  [PRIMARY_AGENT_NAME]: {
    ...primaryAgent,
    model: DEFAULT_MODEL,
    permission: AGENT_PERMISSIONS.orchestration,
  },
  brainstormer: {
    ...brainstormerAgent,
    model: DEFAULT_MODEL,
    permission: AGENT_PERMISSIONS.orchestration,
  },
  bootstrapper: {
    ...bootstrapperAgent,
    model: DEFAULT_MODEL,
    permission: AGENT_PERMISSIONS.research,
  },
  "codebase-locator": {
    ...codebaseLocatorAgent,
    model: DEFAULT_MODEL,
    permission: AGENT_PERMISSIONS.readOnly,
  },
  "codebase-analyzer": {
    ...codebaseAnalyzerAgent,
    model: DEFAULT_MODEL,
    permission: AGENT_PERMISSIONS.readOnly,
  },
  "pattern-finder": {
    ...patternFinderAgent,
    model: DEFAULT_MODEL,
    permission: AGENT_PERMISSIONS.readOnly,
  },
  planner: {
    ...plannerAgent,
    model: DEFAULT_MODEL,
    permission: AGENT_PERMISSIONS.research,
  },
  implementer: {
    ...implementerAgent,
    model: DEFAULT_MODEL,
    permission: AGENT_PERMISSIONS.build,
  },
  reviewer: {
    ...reviewerAgent,
    model: DEFAULT_MODEL,
    permission: AGENT_PERMISSIONS.build,
  },
  executor: {
    ...executorAgent,
    model: DEFAULT_MODEL,
    permission: AGENT_PERMISSIONS.orchestration,
  },
  "ledger-creator": {
    ...ledgerCreatorAgent,
    model: DEFAULT_MODEL,
    permission: AGENT_PERMISSIONS.write,
  },
  "artifact-searcher": {
    ...artifactSearcherAgent,
    model: DEFAULT_MODEL,
    permission: AGENT_PERMISSIONS.readOnly,
  },
  "project-initializer": {
    ...projectInitializerAgent,
    model: DEFAULT_MODEL,
    permission: AGENT_PERMISSIONS.orchestration,
  },
  octto: {
    ...octtoAgent,
    model: DEFAULT_MODEL,
    permission: AGENT_PERMISSIONS.orchestration,
  },
  probe: {
    ...probeAgent,
    model: DEFAULT_MODEL,
    permission: AGENT_PERMISSIONS.readOnly,
  },
  // Mindmodel generation agents (all read-only)
  "mm-stack-detector": {
    ...stackDetectorAgent,
    model: DEFAULT_MODEL,
    permission: AGENT_PERMISSIONS.readOnly,
  },
  "mm-pattern-discoverer": {
    ...mindmodelPatternDiscovererAgent,
    model: DEFAULT_MODEL,
    permission: AGENT_PERMISSIONS.readOnly,
  },
  "mm-example-extractor": {
    ...exampleExtractorAgent,
    model: DEFAULT_MODEL,
    permission: AGENT_PERMISSIONS.readOnly,
  },
  "mm-orchestrator": {
    ...mindmodelOrchestratorAgent,
    model: DEFAULT_MODEL,
    permission: AGENT_PERMISSIONS.readOnly,
  },
  // Mindmodel v2 analysis agents
  "mm-dependency-mapper": {
    ...dependencyMapperAgent,
    model: DEFAULT_MODEL,
    permission: AGENT_PERMISSIONS.readOnly,
  },
  "mm-convention-extractor": {
    ...conventionExtractorAgent,
    model: DEFAULT_MODEL,
    permission: AGENT_PERMISSIONS.readOnly,
  },
  "mm-domain-extractor": {
    ...domainExtractorAgent,
    model: DEFAULT_MODEL,
    permission: AGENT_PERMISSIONS.readOnly,
  },
  "mm-code-clusterer": {
    ...codeClustererAgent,
    model: DEFAULT_MODEL,
    permission: AGENT_PERMISSIONS.readOnly,
  },
  "mm-anti-pattern-detector": {
    ...antiPatternDetectorAgent,
    model: DEFAULT_MODEL,
    permission: AGENT_PERMISSIONS.readOnly,
  },
  "mm-constraint-writer": {
    ...constraintWriterAgent,
    model: DEFAULT_MODEL,
    permission: AGENT_PERMISSIONS.write,
  },
  "mm-constraint-reviewer": {
    ...constraintReviewerAgent,
    model: DEFAULT_MODEL,
    permission: AGENT_PERMISSIONS.readOnly,
  },
};

export {
  artifactSearcherAgent,
  bootstrapperAgent,
  brainstormerAgent,
  codebaseAnalyzerAgent,
  codebaseLocatorAgent,
  executorAgent,
  implementerAgent,
  ledgerCreatorAgent,
  octtoAgent,
  PRIMARY_AGENT_NAME,
  patternFinderAgent,
  plannerAgent,
  primaryAgent,
  probeAgent,
  reviewerAgent,
};
