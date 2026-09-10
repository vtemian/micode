// tests/session-model.test.ts
import { describe, expect, it } from "bun:test";

import { deleteSessionModel, getSessionModel, resolveSpawnModel, setSessionModel } from "../src/session-model";

describe("session-model", () => {
  it("stores and retrieves the model for a session", () => {
    setSessionModel("session-model-s1", { providerID: "opencode", modelID: "hy3-free" });

    expect(getSessionModel("session-model-s1")).toEqual({ providerID: "opencode", modelID: "hy3-free" });
  });

  it("returns undefined for unknown sessions", () => {
    expect(getSessionModel("session-model-missing")).toBeUndefined();
  });

  it("deletes a session's model", () => {
    setSessionModel("session-model-s2", { providerID: "opencode", modelID: "gpt-5.2" });

    deleteSessionModel("session-model-s2");

    expect(getSessionModel("session-model-s2")).toBeUndefined();
  });

  it("spawned agents follow the parent session's model", () => {
    setSessionModel("session-model-parent", { providerID: "opencode", modelID: "hy3-free" });

    expect(resolveSpawnModel("session-model-parent", "implementer", new Set())).toEqual({
      providerID: "opencode",
      modelID: "hy3-free",
    });
  });

  it("an explicit micode.json model override wins over the parent session's model", () => {
    setSessionModel("session-model-parent-2", { providerID: "opencode", modelID: "hy3-free" });

    expect(resolveSpawnModel("session-model-parent-2", "implementer", new Set(["implementer"]))).toBeUndefined();
  });
});
