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

export const agents: Record<string, AgentConfig> = {
  [PRIMARY_AGENT_NAME]: { ...primaryAgent },
  brainstormer: { ...brainstormerAgent },
  bootstrapper: { ...bootstrapperAgent },
  "codebase-locator": { ...codebaseLocatorAgent },
  "codebase-analyzer": { ...codebaseAnalyzerAgent },
  "pattern-finder": { ...patternFinderAgent },
  planner: { ...plannerAgent },
  implementer: { ...implementerAgent },
  reviewer: { ...reviewerAgent },
  executor: { ...executorAgent },
  "ledger-creator": { ...ledgerCreatorAgent },
  "artifact-searcher": { ...artifactSearcherAgent },
  "project-initializer": { ...projectInitializerAgent },
  octto: { ...octtoAgent },
  probe: { ...probeAgent },
  // Mindmodel generation agents
  "mm-stack-detector": { ...stackDetectorAgent },
  "mm-pattern-discoverer": { ...mindmodelPatternDiscovererAgent },
  "mm-example-extractor": { ...exampleExtractorAgent },
  "mm-orchestrator": { ...mindmodelOrchestratorAgent },
  // Mindmodel v2 analysis agents
  "mm-dependency-mapper": { ...dependencyMapperAgent },
  "mm-convention-extractor": { ...conventionExtractorAgent },
  "mm-domain-extractor": { ...domainExtractorAgent },
  "mm-code-clusterer": { ...codeClustererAgent },
  "mm-anti-pattern-detector": { ...antiPatternDetectorAgent },
  "mm-constraint-writer": { ...constraintWriterAgent },
  "mm-constraint-reviewer": { ...constraintReviewerAgent },
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
  ledgerCreatorAgent,
  artifactSearcherAgent,
  octtoAgent,
  probeAgent,
};
