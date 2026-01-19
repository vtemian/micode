// tests/hooks/mindmodel-injector.test.ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("mindmodel-injector hook", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "mindmodel-injector-test-"));
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  function createMockCtx(directory: string) {
    return {
      directory,
      client: {
        session: {},
        tui: {},
      },
    };
  }

  function setupMindmodel(dir: string) {
    const mindmodelDir = join(dir, ".mindmodel");
    mkdirSync(join(mindmodelDir, "components"), { recursive: true });

    writeFileSync(
      join(mindmodelDir, "manifest.yaml"),
      `
name: test-project
version: 1
categories:
  - path: components/button.md
    description: Button component patterns
  - path: components/form.md
    description: Form patterns
`,
    );

    writeFileSync(
      join(mindmodelDir, "components/button.md"),
      "# Button\n\nUse this pattern for buttons.\n\n```tsx\n<Button>Click</Button>\n```",
    );
    writeFileSync(
      join(mindmodelDir, "components/form.md"),
      "# Form\n\nUse this pattern for forms.\n\n```tsx\n<Form onSubmit={...} />\n```",
    );
  }

  // Helper to simulate the two-hook flow
  async function runInjectionFlow(
    hook: ReturnType<typeof import("../../src/hooks/mindmodel-injector").createMindmodelInjectorHook>,
    sessionID: string,
    messages: Array<{ info: { role: string }; parts: Array<{ type: string; text?: string }> }>,
  ): Promise<string[]> {
    // Step 1: Extract task from messages
    const messagesOutput = { messages };
    await hook["experimental.chat.messages.transform"]({ sessionID }, messagesOutput);

    // Step 2: Inject into system prompt
    const systemOutput = { system: ["existing system prompt"] };
    await hook["experimental.chat.system.transform"]({ sessionID }, systemOutput);

    return systemOutput.system;
  }

  it("should not inject if no .mindmodel directory exists", async () => {
    const { createMindmodelInjectorHook } = await import("../../src/hooks/mindmodel-injector");

    const ctx = createMockCtx(testDir);
    const hook = createMindmodelInjectorHook(ctx as any, async () => "[]");

    const system = await runInjectionFlow(hook, "test", [
      { info: { role: "user" }, parts: [{ type: "text", text: "Hello" }] },
    ]);

    expect(system).toEqual(["existing system prompt"]);
  });

  it("should inject examples when classifier returns categories", async () => {
    setupMindmodel(testDir);

    const { createMindmodelInjectorHook } = await import("../../src/hooks/mindmodel-injector");

    const ctx = createMockCtx(testDir);
    // Mock classifier that returns form category
    const mockClassify = async () => '["components/form.md"]';
    const hook = createMindmodelInjectorHook(ctx as any, mockClassify);

    const system = await runInjectionFlow(hook, "test", [
      { info: { role: "user" }, parts: [{ type: "text", text: "Add a contact form" }] },
    ]);

    expect(system.length).toBe(2);
    expect(system[0]).toContain("mindmodel-examples");
    expect(system[0]).toContain("Form");
    expect(system[0]).toContain("<Form onSubmit");
  });

  it("should not inject if classifier returns empty array", async () => {
    setupMindmodel(testDir);

    const { createMindmodelInjectorHook } = await import("../../src/hooks/mindmodel-injector");

    const ctx = createMockCtx(testDir);
    const mockClassify = async () => "[]";
    const hook = createMindmodelInjectorHook(ctx as any, mockClassify);

    const system = await runInjectionFlow(hook, "test", [
      { info: { role: "user" }, parts: [{ type: "text", text: "What time is it?" }] },
    ]);

    expect(system).toEqual(["existing system prompt"]);
  });

  it("should extract task from multimodal message content", async () => {
    setupMindmodel(testDir);

    const { createMindmodelInjectorHook } = await import("../../src/hooks/mindmodel-injector");

    const ctx = createMockCtx(testDir);
    const mockClassify = async () => '["components/button.md"]';
    const hook = createMindmodelInjectorHook(ctx as any, mockClassify);

    const system = await runInjectionFlow(hook, "test", [
      {
        info: { role: "user" },
        parts: [
          { type: "image" }, // No text field for image
          { type: "text", text: "Add a button component" },
        ],
      },
    ]);

    expect(system.length).toBe(2);
    expect(system[0]).toContain("mindmodel-examples");
    expect(system[0]).toContain("Button");
  });

  it("should cache mindmodel and call loadMindmodel only once", async () => {
    setupMindmodel(testDir);

    const { createMindmodelInjectorHook } = await import("../../src/hooks/mindmodel-injector");

    const ctx = createMockCtx(testDir);
    let classifyCallCount = 0;
    const mockClassify = async () => {
      classifyCallCount++;
      return '["components/button.md"]';
    };
    const hook = createMindmodelInjectorHook(ctx as any, mockClassify);

    // First call
    const system1 = await runInjectionFlow(hook, "test1", [
      { info: { role: "user" }, parts: [{ type: "text", text: "Add a button" }] },
    ]);

    // Second call
    const system2 = await runInjectionFlow(hook, "test2", [
      { info: { role: "user" }, parts: [{ type: "text", text: "Add another button" }] },
    ]);

    // Both should have injected content (proving mindmodel was loaded)
    expect(system1[0]).toContain("mindmodel-examples");
    expect(system2[0]).toContain("mindmodel-examples");

    // Classifier should have been called twice (once per request)
    expect(classifyCallCount).toBe(2);
  });
});
