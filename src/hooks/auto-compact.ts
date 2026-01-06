import type { PluginInput } from "@opencode-ai/plugin";
import { getContextLimit } from "../utils/model-limits";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

// Compact when this percentage of context is used
const COMPACT_THRESHOLD = 0.5;

const LEDGER_DIR = "thoughts/ledgers";

// Timeout for waiting for compaction to complete (2 minutes)
const COMPACTION_TIMEOUT_MS = 120_000;

interface PendingCompaction {
  resolve: () => void;
  reject: (error: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
}

interface AutoCompactState {
  inProgress: Set<string>;
  lastCompactTime: Map<string, number>;
  pendingCompactions: Map<string, PendingCompaction>;
}

// Cooldown between compaction attempts (prevent rapid re-triggering)
const COMPACT_COOLDOWN_MS = 30_000; // 30 seconds

export function createAutoCompactHook(ctx: PluginInput) {
  const state: AutoCompactState = {
    inProgress: new Set(),
    lastCompactTime: new Map(),
    pendingCompactions: new Map(),
  };

  async function writeSummaryToLedger(sessionID: string): Promise<void> {
    try {
      // Fetch session messages to find the summary
      const resp = await ctx.client.session.messages({
        path: { id: sessionID },
        query: { directory: ctx.directory },
      });

      const messages = (resp as { data?: unknown[] }).data;
      if (!Array.isArray(messages)) return;

      // Find the summary message (has summary: true)
      const summaryMsg = [...messages].reverse().find((m) => {
        const msg = m as Record<string, unknown>;
        const info = msg.info as Record<string, unknown> | undefined;
        return info?.role === "assistant" && info?.summary === true;
      }) as Record<string, unknown> | undefined;

      if (!summaryMsg) return;

      // Extract text parts from the summary
      const parts = summaryMsg.parts as Array<{ type: string; text?: string }> | undefined;
      if (!parts) return;

      const summaryText = parts
        .filter((p) => p.type === "text" && p.text)
        .map((p) => p.text)
        .join("\n\n");

      if (!summaryText.trim()) return;

      // Create ledger directory if needed
      const ledgerDir = join(ctx.directory, LEDGER_DIR);
      await mkdir(ledgerDir, { recursive: true });

      // Write ledger file - summary is already structured (Factory.ai/pi-mono format)
      const timestamp = new Date().toISOString();
      const sessionName = sessionID.slice(0, 8); // Use first 8 chars of session ID
      const ledgerPath = join(ledgerDir, `CONTINUITY_${sessionName}.md`);

      // Add metadata header, then the structured summary as-is
      const ledgerContent = `---
session: ${sessionName}
updated: ${timestamp}
---

${summaryText}
`;

      await writeFile(ledgerPath, ledgerContent, "utf-8");
    } catch (e) {
      // Don't fail the compaction flow if ledger write fails
      console.error("[auto-compact] Failed to write ledger:", e);
    }
  }

  function waitForCompaction(sessionID: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        state.pendingCompactions.delete(sessionID);
        reject(new Error("Compaction timed out"));
      }, COMPACTION_TIMEOUT_MS);

      state.pendingCompactions.set(sessionID, { resolve, reject, timeoutId });
    });
  }

  async function triggerCompaction(
    sessionID: string,
    providerID: string,
    modelID: string,
    usageRatio: number,
  ): Promise<void> {
    if (state.inProgress.has(sessionID)) {
      return;
    }

    // Check cooldown
    const lastCompact = state.lastCompactTime.get(sessionID) || 0;
    if (Date.now() - lastCompact < COMPACT_COOLDOWN_MS) {
      return;
    }

    state.inProgress.add(sessionID);

    try {
      const usedPercent = Math.round(usageRatio * 100);
      const thresholdPercent = Math.round(COMPACT_THRESHOLD * 100);

      await ctx.client.tui
        .showToast({
          body: {
            title: "Auto Compacting",
            message: `Context at ${usedPercent}% (threshold: ${thresholdPercent}%). Summarizing...`,
            variant: "warning",
            duration: 3000,
          },
        })
        .catch(() => {});

      // Start the compaction - this returns immediately while compaction runs async
      await ctx.client.session.summarize({
        path: { id: sessionID },
        body: { providerID, modelID },
        query: { directory: ctx.directory },
      });

      // Wait for the session.compacted event to confirm completion
      await waitForCompaction(sessionID);

      state.lastCompactTime.set(sessionID, Date.now());

      // Write summary to ledger file (only after compaction is confirmed complete)
      await writeSummaryToLedger(sessionID);

      await ctx.client.tui
        .showToast({
          body: {
            title: "Compaction Complete",
            message: "Session summarized and ledger updated.",
            variant: "success",
            duration: 3000,
          },
        })
        .catch(() => {});
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      await ctx.client.tui
        .showToast({
          body: {
            title: "Compaction Failed",
            message: errorMsg.slice(0, 100),
            variant: "error",
            duration: 5000,
          },
        })
        .catch(() => {});
    } finally {
      state.inProgress.delete(sessionID);
    }
  }

  return {
    event: async ({ event }: { event: { type: string; properties?: unknown } }) => {
      const props = event.properties as Record<string, unknown> | undefined;

      // Handle compaction completion
      if (event.type === "session.compacted") {
        const sessionID = props?.sessionID as string | undefined;
        if (sessionID) {
          const pending = state.pendingCompactions.get(sessionID);
          if (pending) {
            clearTimeout(pending.timeoutId);
            state.pendingCompactions.delete(sessionID);
            pending.resolve();
          }
        }
        return;
      }

      // Cleanup on session delete
      if (event.type === "session.deleted") {
        const sessionInfo = props?.info as { id?: string } | undefined;
        if (sessionInfo?.id) {
          state.inProgress.delete(sessionInfo.id);
          state.lastCompactTime.delete(sessionInfo.id);
          const pending = state.pendingCompactions.get(sessionInfo.id);
          if (pending) {
            clearTimeout(pending.timeoutId);
            state.pendingCompactions.delete(sessionInfo.id);
            pending.reject(new Error("Session deleted"));
          }
        }
        return;
      }

      // Monitor usage on assistant message completion
      if (event.type === "message.updated") {
        const info = props?.info as Record<string, unknown> | undefined;
        const sessionID = info?.sessionID as string | undefined;

        if (!sessionID || info?.role !== "assistant") return;

        // Skip if this is already a summary message
        if (info?.summary === true) return;

        const tokens = info?.tokens as { input?: number; cache?: { read?: number } } | undefined;
        const inputTokens = tokens?.input || 0;
        const cacheRead = tokens?.cache?.read || 0;
        const totalUsed = inputTokens + cacheRead;

        if (totalUsed === 0) return;

        const modelID = (info?.modelID as string) || "";
        const providerID = (info?.providerID as string) || "";
        const contextLimit = getContextLimit(modelID);
        const usageRatio = totalUsed / contextLimit;

        // Trigger compaction if over threshold
        if (usageRatio >= COMPACT_THRESHOLD) {
          triggerCompaction(sessionID, providerID, modelID, usageRatio);
        }
      }
    },
  };
}
