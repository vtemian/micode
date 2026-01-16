import type { AgentConfig } from "@opencode-ai/sdk";
import { brainstormerAgent } from "./brainstormer";
import { bootstrapperAgent } from "./bootstrapper";
import { codebaseLocatorAgent } from "./codebase-locator";
import { codebaseAnalyzerAgent } from "./codebase-analyzer";
import { patternFinderAgent } from "./pattern-finder";
import { plannerAgent } from "./planner";
import { implementerAgent } from "./implementer";
import { reviewerAgent } from "./reviewer";
import { executorAgent } from "./executor";
import { primaryAgent, PRIMARY_AGENT_NAME } from "./commander";
import { projectInitializerAgent } from "./project-initializer";
import { ledgerCreatorAgent } from "./ledger-creator";
import { artifactSearcherAgent } from "./artifact-searcher";
import { octtoAgent } from "./octto";
import { probeAgent } from "./probe";

export const agents: Record<string, AgentConfig> = {
  [PRIMARY_AGENT_NAME]: primaryAgent,
  brainstormer: brainstormerAgent,
  bootstrapper: bootstrapperAgent,
  "codebase-locator": codebaseLocatorAgent,
  "codebase-analyzer": codebaseAnalyzerAgent,
  "pattern-finder": patternFinderAgent,
  planner: plannerAgent,
  implementer: implementerAgent,
  reviewer: reviewerAgent,
  executor: executorAgent,
  "project-initializer": projectInitializerAgent,
  "ledger-creator": ledgerCreatorAgent,
  "artifact-searcher": artifactSearcherAgent,
  octto: octtoAgent,
  probe: probeAgent,
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
