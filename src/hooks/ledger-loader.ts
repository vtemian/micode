// src/hooks/ledger-loader.ts

import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { PluginInput } from "@opencode-ai/plugin";
import { config } from "@/utils/config";

export interface LedgerInfo {
  readonly sessionName: string;
  readonly filePath: string;
  readonly content: string;
}

async function getFileMtime(filePath: string): Promise<number> {
  try {
    const stats = await stat(filePath);
    return stats.mtime.getTime();
  } catch {
    return 0;
  }
}

async function findLatestFile(dir: string, files: string[]): Promise<string> {
  let latestFile = files[0];
  let latestMtime = 0;

  for (const file of files) {
    const mtime = await getFileMtime(join(dir, file));
    if (mtime > latestMtime) {
      latestMtime = mtime;
      latestFile = file;
    }
  }

  return latestFile;
}

export async function findCurrentLedger(directory: string): Promise<LedgerInfo | null> {
  const ledgerDir = join(directory, config.paths.ledgerDir);

  try {
    const files = await readdir(ledgerDir);
    const ledgerFiles = files.filter((f) => f.startsWith(config.paths.ledgerPrefix) && f.endsWith(".md"));

    if (ledgerFiles.length === 0) return null;

    // Get most recently modified ledger
    const latestFile = await findLatestFile(ledgerDir, ledgerFiles);

    const filePath = join(ledgerDir, latestFile);
    const content = await readFile(filePath, "utf-8");
    const sessionName = latestFile.replace(config.paths.ledgerPrefix, "").replace(".md", "");

    return { sessionName, filePath, content };
  } catch {
    return null;
  }
}

export function formatLedgerInjection(ledger: LedgerInfo): string {
  return `<continuity-ledger session="${ledger.sessionName}">
${ledger.content}
</continuity-ledger>

You are resuming work from a previous context clear. The ledger above contains your session state.
Review it and continue from where you left off. The "Now" item is your current focus.`;
}

interface LedgerLoaderHooks {
  "chat.params": (
    _input: { sessionID: string },
    output: { options?: Record<string, unknown>; system?: string },
  ) => Promise<void>;
}

export function createLedgerLoaderHook(ctx: PluginInput): LedgerLoaderHooks {
  return {
    "chat.params": async (
      _input: { sessionID: string },
      output: { options?: Record<string, unknown>; system?: string },
    ) => {
      const ledger = await findCurrentLedger(ctx.directory);
      if (!ledger) return;

      const injection = formatLedgerInjection(ledger);

      if (output.system) {
        output.system = `${injection}\n\n${output.system}`;
      } else {
        output.system = injection;
      }
    },
  };
}
