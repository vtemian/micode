import { tool } from "@opencode-ai/plugin/tool";

export function createAskUserTool() {
  return tool({
    description: `Ask the user a multiple-choice question. ALWAYS provide options.`,
    args: {
      question: tool.schema.string().describe("The question to ask the user"),
      options: tool.schema
        .array(tool.schema.string())
        .min(2)
        .max(6)
        .describe("REQUIRED: 2-6 choices for the user to pick from"),
      context: tool.schema
        .string()
        .optional()
        .describe("Why you're asking (optional)"),
    },
    execute: async (args) => {
      const { question, options, context } = args;

      if (!options || options.length < 2) {
        throw new Error("ask_user FAILED: You must provide 'options' array with 2-6 choices. Example: options: [\"Design\", \"Debug\", \"Implement\"]");
      }

      let output = "---\n## Question for you\n\n";

      if (context) {
        output += `> ${context}\n\n`;
      }

      output += `**${question}**\n`;

      if (options && options.length > 0) {
        output += "\n";
        options.forEach((opt, i) => {
          output += `${i + 1}. ${opt}\n`;
        });
        output += "\n*Reply with a number or your own answer*";
      }

      output += "\n\n---";

      return output;
    },
  });
}
