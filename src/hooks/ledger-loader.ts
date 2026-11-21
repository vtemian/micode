// src/hooks/ledger-loader.ts

import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Workspace } from "@/host/port";
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

async function readLedger(ledgerDir: string, file: string): Promise<LedgerInfo | null> {
  const filePath = join(ledgerDir, file);
  try {
    const content = await readFile(filePath, "utf-8");
    const sessionName = file.replace(config.paths.ledgerPrefix, "").replace(".md", "");
    return { sessionName, filePath, content };
  } catch {
    // A missing or unreadable ledger just means there is nothing to resume from
    return null;
  }
}

async function findNewestLedger(ledgerDir: string): Promise<LedgerInfo | null> {
  try {
    const files = await readdir(ledgerDir);
    const ledgerFiles = files.filter((f) => f.startsWith(config.paths.ledgerPrefix) && f.endsWith(".md"));
    if (ledgerFiles.length === 0) return null;

    return readLedger(ledgerDir, await findLatestFile(ledgerDir, ledgerFiles));
  } catch {
    // No ledger directory yet
    return null;
  }
}

export async function findCurrentLedger(directory: string, sessionID?: string): Promise<LedgerInfo | null> {
  const ledgerDir = join(directory, config.paths.ledgerDir);
  if (sessionID) {
    const own = await readLedger(ledgerDir, `${config.paths.ledgerPrefix}${sessionID}.md`);
    if (own) return own;
  }
  return findNewestLedger(ledgerDir);
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

export function createLedgerLoaderHook(ctx: Workspace): LedgerLoaderHooks {
  return {
    "chat.params": async (
      input: { sessionID: string },
      output: { options?: Record<string, unknown>; system?: string },
    ) => {
      const ledger = await findCurrentLedger(ctx.directory, input.sessionID);
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
