import type { AgentConfig } from "@opencode-ai/sdk";
import { brainstormerAgent } from "./brainstormer";
import { codebaseLocatorAgent } from "./codebase-locator";
import { codebaseAnalyzerAgent } from "./codebase-analyzer";
import { patternFinderAgent } from "./pattern-finder";
import { plannerAgent } from "./planner";
import { implementerAgent } from "./implementer";
import { reviewerAgent } from "./reviewer";
import { executorAgent } from "./executor";
import { handoffCreatorAgent } from "./handoff-creator";
import { handoffResumerAgent } from "./handoff-resumer";
import { primaryAgent, PRIMARY_AGENT_NAME } from "./commander";
import { projectInitializerAgent } from "./project-initializer";
import { ledgerCreatorAgent } from "./ledger-creator";
import { artifactSearcherAgent } from "./artifact-searcher";

export const agents: Record<string, AgentConfig> = {
  [PRIMARY_AGENT_NAME]: primaryAgent,
  brainstormer: brainstormerAgent,
  "codebase-locator": codebaseLocatorAgent,
  "codebase-analyzer": codebaseAnalyzerAgent,
  "pattern-finder": patternFinderAgent,
  planner: plannerAgent,
  implementer: implementerAgent,
  reviewer: reviewerAgent,
  executor: executorAgent,
  "handoff-creator": handoffCreatorAgent,
  "handoff-resumer": handoffResumerAgent,
  "project-initializer": projectInitializerAgent,
  "ledger-creator": ledgerCreatorAgent,
  "artifact-searcher": artifactSearcherAgent,
};

export {
  primaryAgent,
  PRIMARY_AGENT_NAME,
  brainstormerAgent,
  codebaseLocatorAgent,
  codebaseAnalyzerAgent,
  patternFinderAgent,
  plannerAgent,
  implementerAgent,
  reviewerAgent,
  executorAgent,
  handoffCreatorAgent,
  handoffResumerAgent,
  projectInitializerAgent,
  ledgerCreatorAgent,
  artifactSearcherAgent,
};
