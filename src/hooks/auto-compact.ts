import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { HostEvent, ModelRef, SessionHost, Workspace } from "@/host/port";
import { config } from "@/utils/config";
import { extractErrorMessage } from "@/utils/errors";
import { log } from "@/utils/logger";

import type { SessionUsageTracker } from "./session-usage";

const SESSION_ID_PREFIX_LENGTH = 8;
const PERCENT_MULTIPLIER = 100;
const MAX_ERROR_MESSAGE_LENGTH = 100;
const CONTINUE_PROMPT =
  "Context was compacted. Continue from where you left off - check the 'In Progress' and 'Next Steps' sections in the summary above.";

export interface AutoCompactConfig {
  /** Compaction threshold (0-1), defaults to config.compaction.threshold */
  compactionThreshold?: number;
}

export interface AutoCompactHook {
  onEvent(event: HostEvent): Promise<void>;
}

interface AutoCompactState {
  readonly inProgress: Set<string>;
  readonly lastCompactTime: Map<string, number>;
}

interface CompactionRun {
  readonly sessionID: string;
  readonly model: ModelRef;
  readonly ratio: number;
  readonly threshold: number;
}

function percent(ratio: number): number {
  return Math.round(ratio * PERCENT_MULTIPLIER);
}

async function writeLedger(workspace: Workspace, sessionID: string, summary: string): Promise<void> {
  if (!summary.trim()) return;
  try {
    const ledgerDir = join(workspace.directory, config.paths.ledgerDir);
    await mkdir(ledgerDir, { recursive: true });
    const sessionName = sessionID.slice(0, SESSION_ID_PREFIX_LENGTH);
    const ledgerPath = join(ledgerDir, `${config.paths.ledgerPrefix}${sessionName}.md`);
    const frontmatter = `---\nsession: ${sessionName}\nupdated: ${new Date().toISOString()}\n---`;
    await writeFile(ledgerPath, `${frontmatter}\n\n${summary}\n`, "utf-8");
  } catch (error) {
    // Don't fail the compaction flow if the ledger write fails
    log.error("auto-compact", "Failed to write ledger", error);
  }
}

async function compactSession(
  workspace: Workspace,
  host: SessionHost,
  state: AutoCompactState,
  run: CompactionRun,
): Promise<void> {
  const { sessionID, model } = run;
  state.inProgress.add(sessionID);
  try {
    await host.notify({
      title: "Auto Compacting",
      message: `Context at ${percent(run.ratio)}% (threshold: ${percent(run.threshold)}%). Summarizing...`,
      variant: "warning",
      duration: config.timeouts.toastWarningMs,
    });
    const summary = await host.compact(sessionID, model);
    state.lastCompactTime.set(sessionID, Date.now());
    await writeLedger(workspace, sessionID, summary);
    await host.notify({
      title: "Compaction Complete",
      message: "Session summarized. Continuing...",
      variant: "success",
      duration: config.timeouts.toastSuccessMs,
    });
    await autoContinue(host, sessionID, model);
  } catch (error) {
    await host.notify({
      title: "Compaction Failed",
      message: extractErrorMessage(error).slice(0, MAX_ERROR_MESSAGE_LENGTH),
      variant: "error",
      duration: config.timeouts.toastErrorMs,
    });
  } finally {
    state.inProgress.delete(sessionID);
  }
}

/** The compaction itself succeeded; a failed auto-continue only costs the user a manual prompt. */
async function autoContinue(host: SessionHost, sessionID: string, model: ModelRef): Promise<void> {
  try {
    await host.prompt(sessionID, CONTINUE_PROMPT, { model });
  } catch (error) {
    await host.notify({
      title: "Continue Failed",
      message: `Compacted, but could not auto-continue: ${extractErrorMessage(error).slice(0, MAX_ERROR_MESSAGE_LENGTH)}`,
      variant: "warning",
      duration: config.timeouts.toastWarningMs,
    });
  }
}

function coolingDown(state: AutoCompactState, sessionID: string): boolean {
  return Date.now() - (state.lastCompactTime.get(sessionID) ?? 0) < config.compaction.cooldownMs;
}

export function createAutoCompactHook(
  workspace: Workspace,
  host: SessionHost,
  usage: SessionUsageTracker,
  hookConfig?: AutoCompactConfig,
): AutoCompactHook {
  const threshold = hookConfig?.compactionThreshold ?? config.compaction.threshold;
  const state: AutoCompactState = { inProgress: new Set(), lastCompactTime: new Map() };

  return {
    onEvent: async (event) => {
      if (event.type === "session.deleted") {
        state.inProgress.delete(event.sessionID);
        state.lastCompactTime.delete(event.sessionID);
        return;
      }
      if (event.type !== "assistant.usage") return;
      const current = usage.get(event.sessionID);
      if (!current?.model || current.ratio < threshold) return;
      if (state.inProgress.has(event.sessionID) || coolingDown(state, event.sessionID)) return;
      // Compaction runs to completion in the background; the event loop must not wait on it
      const run = { sessionID: event.sessionID, model: current.model, ratio: current.ratio, threshold };
      void compactSession(workspace, host, state, run).catch((error: unknown) => {
        // Last line of defense: a throwing notify must not become an unhandled rejection
        log.error("auto-compact", "Compaction flow failed", error);
      });
    },
  };
}
