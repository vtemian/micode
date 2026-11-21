import type { z } from "zod";

/** The subset of the host tool context micode reads. Both hosts expose the conversation id. */
export interface ToolCall {
  readonly sessionID?: string;
  /** Updates the tool call's title in the UI while it runs (spawn_agent progress). */
  readonly progress?: (title: string) => void;
}

/**
 * A host-agnostic tool. `execute` is a method signature on purpose: method
 * bivariance lets defineTool() hand back a tool whose typed execute narrows
 * `args` without a type assertion.
 */
export interface MicodeTool {
  readonly description: string;
  readonly args: z.ZodRawShape;
  execute(args: unknown, call: ToolCall): Promise<string>;
}

export type MicodeTools = Record<string, MicodeTool>;

interface ToolDefinition<Args extends z.ZodRawShape> {
  readonly description: string;
  readonly args: Args;
  execute(args: z.infer<z.ZodObject<Args>>, call: ToolCall): Promise<string>;
}

/** Identity with typing: hosts wrap the result, micode code gets typed args. */
export function defineTool<Args extends z.ZodRawShape>(definition: ToolDefinition<Args>): MicodeTool {
  return definition;
}
