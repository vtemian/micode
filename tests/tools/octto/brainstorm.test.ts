// tests/tools/octto/brainstorm.test.ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { SessionHost } from "../../../src/host/port";
import type { SessionStore } from "../../../src/octto/session";
import { createStateStore } from "../../../src/octto/state";
import { createBrainstormTools } from "../../../src/tools/octto/brainstorm";
import { config } from "../../../src/utils/config";

const CTX = { sessionID: "s1", progress: () => {} };

describe("brainstorm tools", () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "micode-brainstorm-"));
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it("keeps brainstorm state under the workspace, not the process cwd", async () => {
    const state = createStateStore(join(directory, config.octto.stateDir));
    await state.createSession("bs_workspace", "Design a cache", [{ id: "arch", scope: "Architecture" }]);

    // Neither collaborator is reachable from get_session_summary.
    const tools = createBrainstormTools({} as SessionStore, {} as SessionHost, { directory });
    const summary = await tools.get_session_summary.execute({ session_id: "bs_workspace" }, CTX);

    expect(summary).toContain("<request>Design a cache</request>");
  });
});
