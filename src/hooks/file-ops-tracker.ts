// src/hooks/file-ops-tracker.ts

interface FileOps {
  read: Set<string>;
  modified: Set<string>;
}

type FileOperation = "read" | "write" | "edit";

/** Both hosts' patch tools (`apply_patch` on v1, `patch` on v2) change files like an edit. */
const TRACKED_TOOLS: Readonly<Record<string, FileOperation>> = {
  read: "read",
  write: "write",
  edit: "edit",
  patch: "edit",
  apply_patch: "edit",
};

// Per-session file operation tracking
const sessionFileOps = new Map<string, FileOps>();

function getOrCreateOps(sessionID: string): FileOps {
  let ops = sessionFileOps.get(sessionID);
  if (!ops) {
    ops = { read: new Set(), modified: new Set() };
    sessionFileOps.set(sessionID, ops);
  }
  return ops;
}

export function trackFileOp(sessionID: string, operation: FileOperation, filePath: string): void {
  const ops = getOrCreateOps(sessionID);
  if (operation === "read") {
    ops.read.add(filePath);
  } else {
    // write and edit both modify files
    ops.modified.add(filePath);
  }
}

export function getFileOps(sessionID: string): FileOps {
  const ops = sessionFileOps.get(sessionID);
  if (!ops) {
    return { read: new Set(), modified: new Set() };
  }
  return ops;
}

export function clearFileOps(sessionID: string): void {
  sessionFileOps.delete(sessionID);
}

export function getAndClearFileOps(sessionID: string): FileOps {
  const ops = getFileOps(sessionID);
  // Return copies of the sets before clearing
  const snapshot = {
    read: new Set(ops.read),
    modified: new Set(ops.modified),
  };
  clearFileOps(sessionID);
  return snapshot;
}

export function formatFileOpsForPrompt(ops: FileOps): string {
  const readPaths = Array.from(ops.read).sort();
  const modifiedPaths = Array.from(ops.modified).sort();

  let prompt = "<file-operations>\n";
  prompt += `Read: ${readPaths.length > 0 ? readPaths.join(", ") : "(none)"}\n`;
  prompt += `Modified: ${modifiedPaths.length > 0 ? modifiedPaths.join(", ") : "(none)"}\n`;
  prompt += "</file-operations>";

  return prompt;
}

interface FileOpsTrackerHooks {
  "tool.execute.after": (
    input: { tool: string; sessionID: string; args?: Record<string, unknown> },
    _output: { output?: string },
  ) => Promise<void>;
}

export function createFileOpsTrackerHook(): FileOpsTrackerHooks {
  return {
    "tool.execute.after": async (
      input: { tool: string; sessionID: string; args?: Record<string, unknown> },
      _output: { output?: string },
    ) => {
      const tool = input.tool.toLowerCase();
      const operation = Object.hasOwn(TRACKED_TOOLS, tool) ? TRACKED_TOOLS[tool] : undefined;
      if (!operation) return;

      // Extract file path from args
      const filePath = input.args?.filePath as string | undefined;
      if (!filePath) return;

      trackFileOp(input.sessionID, operation, filePath);
    },
  };
}
