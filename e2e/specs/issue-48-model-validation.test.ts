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

import { describeRun, ensureBuilt, type Run, runAgent, type StubHandle, startStub, stubPort } from "./harness";

const RUN_TIMEOUT_MS = 240_000;
const SPEC_TIMEOUT_MS = RUN_TIMEOUT_MS + 60_000;
const SCRIPT = join(import.meta.dirname, "..", "scripts", "issue-48-models.json");

// One model is declared in the config file; the override exists only in
// opencode's runtime registry. The bug fires exactly in that gap. The provider
// id is "deepseek" because the registry maps it to an OpenAI-compatible npm
// package, so registry-expanded models still speak chat-completions to the
// stub (openai's registry entry would switch to the Responses API instead).
const DECLARED_MODEL = "deepseek-v4-flash";
const OVERRIDE_MODEL = "deepseek-v4-pro";
const REGISTRY_PROVIDER = "deepseek";

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

      // --agent pins the session agent: which agent is opencode's default
      // primary is a moving target across plugin versions, the override is not.
      run = await runAgent("brainstormer", "Say hello.", RUN_TIMEOUT_MS, {
        model: `${REGISTRY_PROVIDER}/${DECLARED_MODEL}`,
        provider: {
          [REGISTRY_PROVIDER]: {
            npm: "@ai-sdk/openai-compatible",
            options: { baseURL: `http://127.0.0.1:${stubPort()}/v1`, apiKey: "stub-key" },
            models: { [DECLARED_MODEL]: { name: "Declared model" } },
          },
        },
        micode: {
          agents: {
            brainstormer: { model: `${REGISTRY_PROVIDER}/${OVERRIDE_MODEL}` },
            commander: { model: `${REGISTRY_PROVIDER}/${OVERRIDE_MODEL}` },
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
