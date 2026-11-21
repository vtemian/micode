/** A file an `apply_patch`-format patch leaves on disk, with the lines it adds there. */
export interface PatchedFile {
  readonly path: string;
  readonly added: string;
}

const ADD = "*** Add File: ";
const UPDATE = "*** Update File: ";
const MOVE = "*** Move to: ";
const DELETE = "*** Delete File: ";
const ADDED_LINE = "+";

interface Draft {
  path: string;
  readonly lines: string[];
}

function opened(line: string): Draft | undefined {
  const header = [ADD, UPDATE].find((prefix) => line.startsWith(prefix));
  return header ? { path: line.slice(header.length).trim(), lines: [] } : undefined;
}

/** Applies one patch line to the file being read; returns the file the following lines belong to. */
function step(current: Draft | undefined, line: string, files: Draft[]): Draft | undefined {
  const next = opened(line);
  if (next) {
    files.push(next);
    return next;
  }
  if (line.startsWith(DELETE)) return undefined;
  if (!current) return undefined;
  if (line.startsWith(MOVE)) current.path = line.slice(MOVE.length).trim();
  else if (line.startsWith(ADDED_LINE)) current.lines.push(line.slice(ADDED_LINE.length));
  return current;
}

/**
 * The files a patch (OpenCode's `apply_patch` on v1, `patch` on v2) adds or updates, in patch order;
 * a moved file is reported at its destination. Deleted files are left out: nothing remains to track.
 */
export function patchedFiles(patch: string): PatchedFile[] {
  const files: Draft[] = [];
  let current: Draft | undefined;
  for (const line of patch.split(/\r?\n/)) current = step(current, line, files);
  return files.map((file) => ({ path: file.path, added: file.lines.join("\n") }));
}
