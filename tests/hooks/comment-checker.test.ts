import { describe, expect, it } from "bun:test";

import { createCommentCheckerHook } from "../../src/hooks/comment-checker";

describe("comment-checker", () => {
  describe("createCommentCheckerHook", () => {
    it("should return a hook with tool.execute.after handler", () => {
      const hook = createCommentCheckerHook();
      expect(hook["tool.execute.after"]).toBeDefined();
      expect(typeof hook["tool.execute.after"]).toBe("function");
    });
  });

  describe("tool.execute.after", () => {
    it("should only process Edit tool calls", async () => {
      const hook = createCommentCheckerHook();
      const output = { output: "success" };

      await hook["tool.execute.after"](
        { tool: "Read", args: { newString: "// increment counter\nconst x = 1;" } },
        output,
      );

      // Output should remain unchanged for non-Edit tools
      expect(output.output).toBe("success");
    });

    it("should detect obvious 'what not why' comments", async () => {
      const hook = createCommentCheckerHook();
      const output = { output: "Edit applied" };

      await hook["tool.execute.after"](
        {
          tool: "edit",
          args: { newString: "// increment the counter\ncount++;" },
        },
        output,
      );

      expect(output.output).toContain("Comment Check");
      expect(output.output).toContain("Explains what, not why");
    });

    it("should detect section divider comments", async () => {
      const hook = createCommentCheckerHook();
      const output = { output: "Edit applied" };

      await hook["tool.execute.after"](
        {
          tool: "edit",
          args: { newString: "// -----\nfunction foo() {}" },
        },
        output,
      );

      expect(output.output).toContain("Comment Check");
    });

    it("should detect empty comments", async () => {
      const hook = createCommentCheckerHook();
      const output = { output: "Edit applied" };

      await hook["tool.execute.after"](
        {
          tool: "edit",
          args: { newString: "//\nconst x = 1;" },
        },
        output,
      );

      expect(output.output).toContain("Comment Check");
    });

    it("should detect 'end of' comments", async () => {
      const hook = createCommentCheckerHook();
      const output = { output: "Edit applied" };

      await hook["tool.execute.after"](
        {
          tool: "edit",
          args: { newString: "// end of function" },
        },
        output,
      );

      expect(output.output).toContain("Comment Check");
    });

    it("should not flag TODO comments", async () => {
      const hook = createCommentCheckerHook();
      const output = { output: "Edit applied" };

      await hook["tool.execute.after"](
        {
          tool: "edit",
          args: { newString: "// TODO: refactor this later\nconst x = 1;" },
        },
        output,
      );

      expect(output.output).toBe("Edit applied");
    });

    it("should not flag eslint directive comments", async () => {
      const hook = createCommentCheckerHook();
      const output = { output: "Edit applied" };

      await hook["tool.execute.after"](
        {
          tool: "edit",
          args: { newString: "// eslint-disable-next-line\nconst x = 1;" },
        },
        output,
      );

      expect(output.output).toBe("Edit applied");
    });

    it("should not flag URL reference comments", async () => {
      const hook = createCommentCheckerHook();
      const output = { output: "Edit applied" };

      await hook["tool.execute.after"](
        {
          tool: "edit",
          args: { newString: "// https://example.com/docs\nconst x = 1;" },
        },
        output,
      );

      expect(output.output).toBe("Edit applied");
    });

    it("ignores the snake_case new_string key, which neither host sends", async () => {
      const hook = createCommentCheckerHook();
      const output = { output: "File edited" };
      await hook["tool.execute.after"]({ tool: "edit", args: { new_string: "// increment x\nx++;" } }, output);
      expect(output.output).toBe("File edited");
    });

    it("should skip when newString is missing", async () => {
      const hook = createCommentCheckerHook();
      const output = { output: "Edit applied" };

      await hook["tool.execute.after"]({ tool: "edit", args: {} }, output);

      expect(output.output).toBe("Edit applied");
    });

    it("should skip when args is undefined", async () => {
      const hook = createCommentCheckerHook();
      const output = { output: "Edit applied" };

      await hook["tool.execute.after"]({ tool: "edit" }, output);

      expect(output.output).toBe("Edit applied");
    });

    it("should detect excessive consecutive comments", async () => {
      const hook = createCommentCheckerHook();
      const output = { output: "Edit applied" };

      // 7 consecutive non-valid comments (exceeds MAX_CONSECUTIVE_COMMENTS=5)
      const lines = [
        "// line one comment",
        "// line two comment",
        "// line three comment",
        "// line four comment",
        "// line five comment",
        "// line six comment",
        "// line seven comment",
        "const x = 1;",
      ].join("\n");

      await hook["tool.execute.after"]({ tool: "edit", args: { newString: lines } }, output);

      expect(output.output).toContain("Comment Check");
      expect(output.output).toContain("Excessive consecutive comments");
    });

    it("should limit displayed issues to MAX_ISSUES_SHOWN and show overflow", async () => {
      const hook = createCommentCheckerHook();
      const output = { output: "Edit applied" };

      // Many bad comments to exceed MAX_ISSUES_SHOWN (3)
      const lines = [
        "// set the value",
        "// get the data",
        "// return the result",
        "// create the object",
        "// initialize the state",
      ].join("\n");

      await hook["tool.execute.after"]({ tool: "edit", args: { newString: lines } }, output);

      expect(output.output).toContain("Comment Check");
      expect(output.output).toContain("...and");
      expect(output.output).toContain("more");
    });

    it("should handle clean code with no issues", async () => {
      const hook = createCommentCheckerHook();
      const output = { output: "Edit applied" };

      await hook["tool.execute.after"](
        {
          tool: "edit",
          args: { newString: "const x = 1;\nconst y = 2;" },
        },
        output,
      );

      expect(output.output).toBe("Edit applied");
    });

    it("should handle lowercase 'edit' tool name", async () => {
      const hook = createCommentCheckerHook();
      const output = { output: "Edit applied" };

      await hook["tool.execute.after"](
        {
          tool: "edit",
          args: { newString: "// increment x\nx++;" },
        },
        output,
      );

      expect(output.output).toContain("Comment Check");
    });

    it("checks the lines both hosts' patch tools add", async () => {
      const hook = createCommentCheckerHook();
      for (const tool of ["patch", "apply_patch"]) {
        const output = { output: "Success." };
        await hook["tool.execute.after"]({ tool, args: { newString: "// increment x\nx++;" } }, output);
        expect(output.output).toContain("Comment Check");
      }
    });
  });
});
