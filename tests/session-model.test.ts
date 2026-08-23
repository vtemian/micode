// tests/session-model.test.ts
import { describe, expect, it } from "bun:test";

import { deleteSessionModel, getSessionModel, setSessionModel } from "../src/session-model";

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
});
