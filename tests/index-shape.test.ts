import { describe, expect, it } from "bun:test";

describe("package entrypoint", () => {
  it("default-exports the dual v1/v2 plugin object and nothing callable by name", async () => {
    const surface: Record<string, unknown> = await import("../src/index");
    const micode = surface.default as Record<string, unknown>;
    expect(micode.id).toBe("micode");
    expect(typeof micode.setup).toBe("function");
    expect(typeof micode.server).toBe("function");
    // v1 rejects modules that define both `server` and `tui`.
    expect("tui" in micode).toBe(false);
    // v1 < 1.18.29 called every exported function as a plugin; keep the named surface free of functions.
    const callable = Object.entries(surface)
      .filter(([name, value]) => name !== "default" && typeof value === "function")
      .map(([name]) => name);
    expect(callable).toEqual([]);
  });
});
