import { basename, resolve } from "node:path";

import type { AgentConfig, McpLocalConfig } from "@opencode-ai/sdk";

import { agents, PRIMARY_AGENT_NAME } from "@/agents";
import {
  loadMicodeConfig,
  loadModelContextLimits,
  loadOpencodeSettings,
  type MicodeConfig,
  mergeAgentConfigs,
} from "@/config-loader";
import {
  ConstraintViolationError,
  clearFileOps,
  createArtifactAutoIndexHook,
  createAutoCompactHook,
  createCommentCheckerHook,
  createConstraintReviewerHook,
  createContextInjectorHook,
  createContextWindowMonitorHook,
  createFetchTrackerHook,
  createFileOpsTrackerHook,
  createFragmentInjectorHook,
  createLedgerLoaderHook,
  createMindmodelInjectorHook,
  createSessionRecoveryHook,
  createSessionUsage,
  createTokenAwareTruncationHook,
  getFileOps,
  type SessionUsageTracker,
  warnUnknownAgents,
} from "@/hooks";
import type { HostEvent, ModelRef, SessionHost, Workspace } from "@/host/port";
import { buildMcpServers } from "@/plugin-config";
import { deleteSessionModel, setSessionModel } from "@/session-model";
import {
  artifact_search,
  btca_ask,
  checkAstGrepAvailable,
  checkBtcaAvailable,
  createAstGrepTools,
  createBatchReadTool,
  createLookAtTool,
  createMindmodelLookupTool,
  createOcttoTools,
  createPTYManager,
  createPtyTools,
  createSessionStore,
  createSpawnAgentTool,
  loadBunPty,
  milestone_artifact_search,
} from "@/tools";
import type { MicodeTools } from "@/tools/define";
import type { PTYManager } from "@/tools/pty";
import { config } from "@/utils/config";
import { extractErrorMessage } from "@/utils/errors";
import { log } from "@/utils/logger";
import { patchedFiles } from "@/utils/patch";

export { ConstraintViolationError };

export interface MicodeOptions {
  readonly directory: string;
  readonly host: SessionHost;
}

export interface MicodeCommand {
  readonly name: string;
  readonly description: string;
  readonly agent: string;
  /** `$ARGUMENTS` is replaced by the user's text. */
  readonly template: string;
}

export interface PromptEvent {
  readonly sessionID: string;
  readonly text: string;
  readonly agent?: string;
  readonly model?: ModelRef;
}

export interface RequestEvent {
  readonly sessionID: string;
  readonly agent?: string;
  readonly model?: ModelRef;
}

export interface SystemPromptRequest {
  readonly sessionID: string;
  readonly system: readonly string[];
  readonly agent?: string;
  /** Last user message text when the host exposes it; otherwise the text recorded by `onPrompt` is used. */
  readonly userText?: string;
}

export interface ToolResultEvent {
  readonly tool: string;
  readonly sessionID: string;
  readonly args?: Record<string, unknown>;
  readonly output: string;
}

export interface Micode {
  readonly tools: MicodeTools;
  /** v1 AgentConfig shape; the v2 adapter maps it. */
  readonly agents: Record<string, AgentConfig>;
  readonly defaultAgent: string;
  readonly commands: readonly MicodeCommand[];
  readonly mcpServers: Record<string, McpLocalConfig>;
  /** Permission actions micode allows without prompting. */
  readonly allowedActions: readonly string[];
  onPrompt(prompt: PromptEvent): Promise<void>;
  /** Records the agent and model a session is about to use (v2 learns them only at request time). */
  onRequest(request: RequestEvent): void;
  /** Returns the system prompt entries for the next model request. */
  systemPrompt(request: SystemPromptRequest): Promise<string[]>;
  /** Provider request options for the next model request (thinking budget). */
  requestOptions(sessionID: string): Record<string, unknown>;
  compactionInstruction(sessionID: string): string;
  /** Post-processes a tool's output. Throws ConstraintViolationError after repeated violations. */
  onToolResult(result: ToolResultEvent): Promise<string>;
  onEvent(event: HostEvent): Promise<void>;
  dispose(): Promise<void>;
}

const THINK_KEYWORDS = [
  /\bthink\s*(hard|deeply|carefully|through)\b/i,
  /\bthink\b.*\b(about|on|through)\b/i,
  /\b(deeply|carefully)\s*think\b/i,
  /\blet('s|s)?\s*think\b/i,
];

/** Built per request so a provider adapter mutating the options cannot leak into the next call. */
function thinkingOptions(): Record<string, unknown> {
  return { thinking: { type: "enabled", budgetTokens: config.thinking.budgetTokens } };
}

const ALLOWED_ACTIONS = ["edit", "bash", "webfetch", "external_directory"] as const;
/** OpenCode's patch tool: `apply_patch` on v1, `patch` on v2; gpt models get it instead of edit/write. */
const PATCH_TOOLS: readonly string[] = ["patch", "apply_patch"];

type ToolArgs = ToolResultEvent["args"];

interface ToolCall {
  readonly tool: string;
  readonly sessionID: string;
  readonly args: ToolArgs;
}

const COMMANDS: readonly MicodeCommand[] = [
  {
    name: "init",
    description: "Initialize project with ARCHITECTURE.md and CODE_STYLE.md",
    agent: "project-initializer",
    template: "Initialize this project. $ARGUMENTS",
  },
  {
    name: "mindmodel",
    description: "Generate .mindmodel/ constraints for this project",
    agent: "mm-orchestrator",
    template: "Generate mindmodel for this project. $ARGUMENTS",
  },
  {
    name: "ledger",
    description: "Create or update continuity ledger for session state",
    agent: "ledger-creator",
    template: "Update the continuity ledger. $ARGUMENTS",
  },
  {
    name: "search",
    description: "Search past handoffs, plans, and ledgers",
    agent: "artifact-searcher",
    template: "Search for: $ARGUMENTS",
  },
];

const LEDGER_COMMAND = "/ledger";
const LEDGER_TEMPLATE_PREFIX = "Update the continuity ledger.";
const REVIEWER_AGENT = "mm-constraint-reviewer";
const REVIEW_SKIPPED = '{"status": "PASS", "violations": [], "summary": "Review failed"}';
const LOG_SCOPE = "micode";
// Both hosts render each loaded instruction file as "Instructions from: <path>\n<content>" and may join
// several files into one entry with "\n", so filtering works per block, not per entry.
const INSTRUCTIONS_PREFIX = "Instructions from: ";
const INSTRUCTIONS_BLOCK_START = /\n(?=Instructions from: )/;
const PROJECT_INSTRUCTION_FILES = ["CLAUDE.md", "AGENTS.md"];

interface SessionState {
  readonly internal: Set<string>;
  /** Sessions micode compacted or that opened with a ledger resume; only these get the continuity ledger. */
  readonly resumed: Set<string>;
  thinkMode(sessionID: string): boolean;
  agentOf(sessionID: string): string | undefined;
  userTextOf(sessionID: string): string | undefined;
  remember(request: RequestEvent): void;
  recordPrompt(prompt: PromptEvent): void;
  forget(sessionID: string): void;
}

interface CoreHooks {
  readonly fragments: ReturnType<typeof createFragmentInjectorHook>;
  readonly ledger: ReturnType<typeof createLedgerLoaderHook>;
  readonly context: ReturnType<typeof createContextInjectorHook>;
  readonly monitor: ReturnType<typeof createContextWindowMonitorHook>;
  readonly truncation: ReturnType<typeof createTokenAwareTruncationHook>;
  readonly comments: ReturnType<typeof createCommentCheckerHook>;
  readonly artifacts: ReturnType<typeof createArtifactAutoIndexHook>;
  readonly fileOps: ReturnType<typeof createFileOpsTrackerHook>;
  readonly fetch: ReturnType<typeof createFetchTrackerHook>;
  readonly autoCompact: ReturnType<typeof createAutoCompactHook>;
  readonly recovery: ReturnType<typeof createSessionRecoveryHook>;
  readonly mindmodel: ReturnType<typeof createMindmodelInjectorHook> | null;
  readonly reviewer: ReturnType<typeof createConstraintReviewerHook>;
}

interface OcttoAssembly {
  readonly tools: MicodeTools;
  endSessionsOf(parentSessionID: string): Promise<void>;
  dispose(): Promise<void>;
}

function detectThinkKeyword(text: string): boolean {
  return THINK_KEYWORDS.some((pattern) => pattern.test(text));
}

function isLedgerResume(text: string): boolean {
  const trimmed = text.trimStart();
  return trimmed.startsWith(LEDGER_COMMAND) || trimmed.startsWith(LEDGER_TEMPLATE_PREFIX);
}

function isProjectInstructions(block: string): boolean {
  if (!block.startsWith(INSTRUCTIONS_PREFIX)) return false;
  const path = block.slice(INSTRUCTIONS_PREFIX.length).split("\n")[0].trim();
  return PROJECT_INSTRUCTION_FILES.includes(basename(path));
}

/** micode injects its own project context, so the host's CLAUDE.md/AGENTS.md blocks would duplicate it. */
function withoutProjectInstructions(system: readonly string[]): string[] {
  return system
    .map((entry) =>
      entry
        .split(INSTRUCTIONS_BLOCK_START)
        .filter((block) => !isProjectInstructions(block))
        .join("\n"),
    )
    .filter((entry) => entry.length > 0);
}

function formatPaths(paths: readonly string[]): string {
  return paths.length > 0 ? paths.map((p) => `- \`${p}\``).join("\n") : "- (none)";
}

function compactionPrompt(sessionID: string): string {
  const fileOps = getFileOps(sessionID);
  const fileOpsSection = `
## File Operations
### Read
${formatPaths(Array.from(fileOps.read).sort())}

### Modified
${formatPaths(Array.from(fileOps.modified).sort())}`;

  return `Create a structured summary for continuing this conversation. Use this EXACT format:

# Session Summary

## Goal
{The core objective being pursued - one sentence describing success criteria}

## Constraints & Preferences
{Technical requirements, patterns to follow, things to avoid - or "(none)"}

## Progress
### Done
- [x] {Completed items with specific details}

### In Progress
- [ ] {Current work - what's actively being worked on}

### Blocked
- {Issues preventing progress, if any - or "(none)"}

## Key Decisions
- **{Decision}**: {Rationale - why this choice was made}

## Next Steps
1. {Ordered list of what to do next - be specific}

## Critical Context
- {Data, examples, references, or findings needed to continue work}
- {Important discoveries or insights from this session}
${fileOpsSection}

IMPORTANT:
- Preserve EXACT file paths and function names
- Focus on information needed to continue seamlessly
- Be specific about what was done, not vague summaries
- Include any error messages or issues encountered`;
}

async function warnMissingTools(): Promise<void> {
  const astGrep = await checkAstGrepAvailable();
  if (!astGrep.available) log.warn(LOG_SCOPE, astGrep.message ?? "ast-grep unavailable");
  const btca = await checkBtcaAvailable();
  if (!btca.available) log.warn(LOG_SCOPE, btca.message ?? "btca unavailable");
}

function warnOpencodeSettings(): void {
  for (const warning of loadOpencodeSettings().warnings) log.warn(LOG_SCOPE, `opencode config: ${warning}`);
}

function warnUnknownFragmentAgents(userConfig: MicodeConfig | null): void {
  if (!userConfig?.fragments) return;
  const known = new Set(Object.keys(agents));
  for (const warning of warnUnknownAgents(Object.keys(userConfig.fragments), known)) {
    log.warn(LOG_SCOPE, warning);
  }
}

function createSessionState(): SessionState {
  const thinking = new Map<string, boolean>();
  const sessionAgents = new Map<string, string>();
  const userTexts = new Map<string, string>();

  function remember({ sessionID, agent, model }: RequestEvent): void {
    if (model) setSessionModel(sessionID, model);
    if (agent) sessionAgents.set(sessionID, agent);
  }

  const resumed = new Set<string>();
  const internal = new Set<string>();

  return {
    internal,
    resumed,
    thinkMode: (sessionID) => thinking.get(sessionID) ?? false,
    agentOf: (sessionID) => sessionAgents.get(sessionID),
    userTextOf: (sessionID) => userTexts.get(sessionID),
    remember,
    recordPrompt: (prompt) => {
      if (!userTexts.has(prompt.sessionID) && isLedgerResume(prompt.text)) resumed.add(prompt.sessionID);
      remember(prompt);
      thinking.set(prompt.sessionID, detectThinkKeyword(prompt.text));
      userTexts.set(prompt.sessionID, prompt.text);
    },
    forget: (sessionID) => {
      internal.delete(sessionID);
      resumed.delete(sessionID);
      thinking.delete(sessionID);
      sessionAgents.delete(sessionID);
      userTexts.delete(sessionID);
      deleteSessionModel(sessionID);
    },
  };
}

/**
 * Sessions micode creates for its own runs (reviewer, probe) are internal from creation until removed:
 * they get no system-prompt injection and do not re-trigger the hooks that spawned them.
 */
export function trackInternalSessions(host: SessionHost, internal: Set<string>): SessionHost {
  return {
    ...host,
    runAgent: (run) =>
      host.runAgent({
        ...run,
        onCreated: (id) => {
          internal.add(id);
          run.onCreated?.(id);
        },
      }),
    remove: async (sessionID) => {
      internal.delete(sessionID);
      await host.remove(sessionID);
    },
  };
}

function createReviewer(host: SessionHost): (prompt: string) => Promise<string> {
  return async (reviewPrompt) => {
    let sessionID: string | undefined;
    try {
      const reply = await host.runAgent({
        agent: REVIEWER_AGENT,
        text: reviewPrompt,
        title: "constraint-reviewer",
        denyTools: true,
        onCreated: (id) => {
          sessionID = id;
        },
      });
      return reply.text || REVIEW_SKIPPED;
    } catch (error) {
      log.warn("mindmodel", `Reviewer failed: ${extractErrorMessage(error)}`);
      return REVIEW_SKIPPED;
    } finally {
      if (sessionID) await host.remove(sessionID);
    }
  };
}

function createHooks(
  workspace: Workspace,
  host: SessionHost,
  usage: SessionUsageTracker,
  userConfig: MicodeConfig | null,
  sessions: SessionState,
): CoreHooks {
  const internalHost = trackInternalSessions(host, sessions.internal);
  return {
    fragments: createFragmentInjectorHook(workspace, userConfig),
    ledger: createLedgerLoaderHook(workspace),
    context: createContextInjectorHook(workspace),
    monitor: createContextWindowMonitorHook(usage, (notification) => host.notify(notification)),
    truncation: createTokenAwareTruncationHook(usage),
    comments: createCommentCheckerHook(),
    artifacts: createArtifactAutoIndexHook(),
    fileOps: createFileOpsTrackerHook(),
    fetch: createFetchTrackerHook(),
    autoCompact: createAutoCompactHook(workspace, host, usage, {
      compactionThreshold: userConfig?.compactionThreshold,
      onCompacted: (sessionID) => sessions.resumed.add(sessionID),
    }),
    recovery: createSessionRecoveryHook(host),
    // Feature-flagged: set features.mindmodelInjection=true in micode.json to enable
    mindmodel: userConfig?.features?.mindmodelInjection ? createMindmodelInjectorHook(workspace) : null,
    reviewer: createConstraintReviewerHook(workspace, createReviewer(internalHost)),
  };
}

async function createPty(workspace: Workspace): Promise<PTYManager> {
  // bun-pty loads with graceful degradation; see https://github.com/vtemian/micode/issues/20
  const manager = createPTYManager();
  const bunPty = await loadBunPty(workspace.directory);
  if (bunPty) manager.init(bunPty.spawn);
  return manager;
}

function createOctto(host: SessionHost, workspace: Workspace): OcttoAssembly {
  // The octto probe runs through this host, so its sessions are internal like the reviewer's.
  const store = createSessionStore();
  const byParent = new Map<string, Set<string>>();
  const tools = createOcttoTools(store, host, workspace, {
    onCreated: (parent, id) => {
      const ids = byParent.get(parent) ?? new Set<string>();
      ids.add(id);
      byParent.set(parent, ids);
    },
    onEnded: (parent, id) => {
      const ids = byParent.get(parent);
      if (!ids) return;
      ids.delete(id);
      if (ids.size === 0) byParent.delete(parent);
    },
  });
  return {
    tools,
    endSessionsOf: async (parent) => {
      for (const id of byParent.get(parent) ?? []) {
        await store.endSession(id).catch((_e: unknown) => {
          /* fire-and-forget */
        });
      }
      byParent.delete(parent);
    },
    dispose: () => store.cleanup(),
  };
}

function assembleTools(
  workspace: Workspace,
  host: SessionHost,
  userConfig: MicodeConfig | null,
  pty: PTYManager,
  octtoTools: MicodeTools,
): MicodeTools {
  // Agents with an explicit model in micode.json keep it: a deliberate
  // per-agent choice wins over following the parent session's live model.
  const overrides = new Set(
    Object.entries(userConfig?.agents ?? {})
      .filter(([, override]) => override.model)
      .map(([name]) => name),
  );
  return {
    ...createAstGrepTools(workspace),
    btca_ask,
    look_at: createLookAtTool(workspace),
    artifact_search,
    milestone_artifact_search,
    spawn_agent: createSpawnAgentTool(host, overrides),
    batch_read: createBatchReadTool(workspace),
    ...createMindmodelLookupTool(workspace),
    ...(pty.available ? createPtyTools(pty, workspace) : {}),
    ...octtoTools,
  };
}

/**
 * The injectors still share the v1-era `{ system }` output object. Fragments
 * first, then ledger, then project context, then the context-window status.
 */
async function userSystemBlock(
  hooks: CoreHooks,
  sessionID: string,
  agent: string | undefined,
  resumed: boolean,
): Promise<string> {
  const output: { system?: string } = {};
  const input = { sessionID, agent };
  await hooks.fragments["chat.params"](input, output);
  if (resumed) await hooks.ledger["chat.params"](input, output);
  await hooks.context["chat.params"](input, output);
  return output.system ?? "";
}

async function injectMindmodel(
  mindmodel: NonNullable<CoreHooks["mindmodel"]>,
  sessionID: string,
  userText: string | undefined,
  output: { system: string[] },
): Promise<void> {
  if (userText) {
    const messages = [{ info: { role: "user" }, parts: [{ type: "text", text: userText }] }];
    await mindmodel["experimental.chat.messages.transform"]({}, { messages });
  }
  await mindmodel["experimental.chat.system.transform"]({ sessionID }, output);
}

function createSystemPrompt(hooks: CoreHooks, sessions: SessionState): Micode["systemPrompt"] {
  return async (request) => {
    const { sessionID } = request;
    if (sessions.internal.has(sessionID)) return [...request.system];
    const output = { system: withoutProjectInstructions(request.system) };
    if (hooks.mindmodel) {
      await injectMindmodel(hooks.mindmodel, sessionID, request.userText ?? sessions.userTextOf(sessionID), output);
    }
    const agent = request.agent ?? sessions.agentOf(sessionID);
    const block = await userSystemBlock(hooks, sessionID, agent, sessions.resumed.has(sessionID));
    if (block) output.system.unshift(block);
    // The usage status changes every turn; it goes last so the cached system prefix stays stable.
    const status = hooks.monitor.systemSuffix(sessionID);
    if (status) output.system.push(status.trim());
    return output.system;
  };
}

/**
 * A patch names its files only inside `patchText`, so the file hooks run once per file it leaves on
 * disk, each seeing it as `filePath` (resolved like the hosts resolve it) and its added lines as `newString`.
 */
function targetsOf(result: ToolResultEvent, directory: string): readonly ToolArgs[] {
  const patch = result.args?.patchText;
  if (!PATCH_TOOLS.includes(result.tool) || typeof patch !== "string") return [result.args];
  return patchedFiles(patch).map((file) => ({
    ...result.args,
    filePath: resolve(directory, file.path),
    newString: file.added,
  }));
}

async function runFileHooks(hooks: CoreHooks, input: ToolCall, output: { output?: string }): Promise<void> {
  await hooks.comments["tool.execute.after"](input, output);
  await hooks.context["tool.execute.after"](input, output);
  await hooks.artifacts["tool.execute.after"](input, output);
  await hooks.fileOps["tool.execute.after"](input, output);
  await hooks.fetch["tool.execute.after"](input, output);
  await hooks.reviewer["tool.execute.after"](input, output);
}

function createToolResultPipeline(hooks: CoreHooks, directory: string): Micode["onToolResult"] {
  return async (result) => {
    const output = { output: await hooks.truncation.onToolResult(result) };
    for (const args of targetsOf(result, directory)) {
      await runFileHooks(hooks, { tool: result.tool, sessionID: result.sessionID, args }, output);
    }
    return output.output ?? "";
  };
}

function createEventRouter(
  hooks: CoreHooks,
  usage: SessionUsageTracker,
  sessions: SessionState,
  pty: PTYManager,
  octto: OcttoAssembly,
): Micode["onEvent"] {
  async function forget(sessionID: string): Promise<void> {
    sessions.forget(sessionID);
    pty.cleanupBySession(sessionID);
    hooks.reviewer.cleanupSession(sessionID);
    hooks.fetch.cleanupSession(sessionID);
    clearFileOps(sessionID);
    await octto.endSessionsOf(sessionID);
  }

  // One listener failing must not hide the event from the others.
  async function settle(label: string, listener: () => Promise<void>): Promise<void> {
    try {
      await listener();
    } catch (error) {
      log.error(LOG_SCOPE, `${label} listener failed`, error);
    }
  }

  return async (event) => {
    usage.onEvent(event);
    if (event.type === "session.deleted") await settle("session cleanup", () => forget(event.sessionID));
    await settle("auto-compact", () => hooks.autoCompact.onEvent(event));
    await settle("session recovery", () => hooks.recovery.onEvent(event));
    await settle("context window monitor", () => hooks.monitor.onEvent(event));
  };
}

export async function createMicode({ directory, host }: MicodeOptions): Promise<Micode> {
  await warnMissingTools();
  const workspace: Workspace = { directory };
  const userConfig = await loadMicodeConfig();
  warnUnknownFragmentAgents(userConfig);
  warnOpencodeSettings();
  const usage = createSessionUsage(loadModelContextLimits());
  const sessions = createSessionState();
  const hooks = createHooks(workspace, host, usage, userConfig, sessions);
  const pty = await createPty(workspace);
  const octto = createOctto(trackInternalSessions(host, sessions.internal), workspace);

  return {
    tools: assembleTools(workspace, host, userConfig, pty, octto.tools),
    agents: mergeAgentConfigs(agents, userConfig),
    defaultAgent: PRIMARY_AGENT_NAME,
    commands: COMMANDS,
    mcpServers: buildMcpServers(userConfig?.features),
    allowedActions: ALLOWED_ACTIONS,
    onPrompt: async (prompt) => {
      sessions.recordPrompt(prompt);
      // Check for override command
      await hooks.reviewer["chat.message"](
        { sessionID: prompt.sessionID },
        { parts: [{ type: "text", text: prompt.text }] },
      );
    },
    onRequest: (request) => sessions.remember(request),
    systemPrompt: createSystemPrompt(hooks, sessions),
    requestOptions: (sessionID) => (sessions.thinkMode(sessionID) ? thinkingOptions() : {}),
    compactionInstruction: (sessionID) => {
      // The host compacts with this instruction, so the next turn resumes from the summary and ledger.
      sessions.resumed.add(sessionID);
      return compactionPrompt(sessionID);
    },
    onToolResult: createToolResultPipeline(hooks, directory),
    onEvent: createEventRouter(hooks, usage, sessions, pty, octto),
    dispose: async () => {
      pty.cleanupAll();
      await octto.dispose();
    },
  };
}
