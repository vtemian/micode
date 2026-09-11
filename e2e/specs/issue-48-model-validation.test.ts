/**
 * Regression spec for https://github.com/vtemian/micode/issues/48
 * "micode rejects model openai/gpt-5.x as default for brainstormer / commander".
 *
 * The model validator in config-loader checks per-agent overrides against
 * loadAvailableModels(), which reads only the provider.models maps written in
 * opencode.json. Registry-backed providers (openai, github-copilot, opencode)
 * serve far more models at runtime than the config file declares, so a valid
 * override is rejected with "is not available" and the agent silently falls
 * back. Here the openai provider points at the stub via baseURL, declares one
 * model, and the override asks for another that the runtime registry knows.
 *
 * This spec FAILS while the validator is stricter than the runtime registry.
 */
import { afterAll, describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";

import { describeRun, ensureBuilt, type Run, runPrompt, type StubHandle, startStub, stubPort } from "./harness";

const RUN_TIMEOUT_MS = 240_000;
const SPEC_TIMEOUT_MS = RUN_TIMEOUT_MS + 60_000;
const SCRIPT = join(import.meta.dirname, "..", "scripts", "issue-48-models.json");

// gpt-5 is declared in the config file; gpt-5.1 exists only in opencode's
// runtime registry. The bug fires exactly in that gap.
const DECLARED_MODEL = "gpt-5";
const OVERRIDE_MODEL = "gpt-5.1";

describe("issue #48: per-agent model override survives validation", () => {
  let stub: StubHandle | undefined;
  let run: Run | undefined;

  afterAll(() => {
    if (run) {
      rmSync(run.projectDir, { recursive: true, force: true });
      rmSync(run.homeDir, { recursive: true, force: true });
    }
    stub?.stop();
  });

  it(
    "runs the primary agents on the registry-known override, not the fallback",
    async () => {
      ensureBuilt();
      stub = await startStub(SCRIPT);

      run = await runPrompt("Say hello.", RUN_TIMEOUT_MS, {
        model: `openai/${DECLARED_MODEL}`,
        provider: {
          openai: {
            // chat-completions wire format, but the provider id stays "openai"
            // so the runtime registry keeps its model list.
            npm: "@ai-sdk/openai-compatible",
            options: { baseURL: `http://127.0.0.1:${stubPort()}/v1`, apiKey: "stub-key" },
            models: { [DECLARED_MODEL]: { name: "Declared model" } },
          },
        },
        micode: {
          agents: {
            brainstormer: { model: `openai/${OVERRIDE_MODEL}` },
            commander: { model: `openai/${OVERRIDE_MODEL}` },
          },
        },
      });

      expect(run.timedOut, describeRun(run)).toBe(false);
      expect(run.exitCode, describeRun(run)).toBe(0);

      // The rejection warning the issue reporter saw.
      expect(run.stderr, describeRun(run)).not.toContain("is not available");
      // The DEBUG log of the session stream proves which model actually ran.
      expect(run.stderr, describeRun(run)).toContain(`modelID=${OVERRIDE_MODEL}`);
    },
    SPEC_TIMEOUT_MS,
  );
});
