// src/tools/octto/questions.ts
import { z } from "zod";
import type { SessionStore } from "@/octto/session";
import type { ConfirmConfig, PickManyConfig, PickOneConfig, RankConfig, RateConfig } from "@/octto/types";
import { createQuestionToolFactory } from "./factory";
import type { OcttoTool, OcttoTools } from "./types";

const DESC_QUESTION = "Question to display";
const DESC_CONTEXT = "Instructions/context";
const ERR_OPTIONS_EMPTY = "options array must not be empty";
const DEFAULT_RATING_MAX = 5;

const optionsSchema = z
  .array(
    z.object({
      id: z.string().describe("Unique option identifier"),
      label: z.string().describe("Display label"),
      description: z.string().optional().describe("Optional description"),
    }),
  )
  .describe("Available options");

function requireOptions(args: { options?: unknown[] }): string | null {
  if (!args.options || args.options.length === 0) return ERR_OPTIONS_EMPTY;
  return null;
}

function buildPickOneTool(sessions: SessionStore): OcttoTool {
  const createTool = createQuestionToolFactory(sessions);
  return createTool<PickOneConfig & { session_id: string }>({
    type: "pick_one",
    description: `Ask user to select ONE option from a list.
Response format: { selected: string } where selected is the chosen option id.`,
    args: {
      question: z.string().describe(DESC_QUESTION),
      options: optionsSchema,
      recommended: z.string().optional().describe("Recommended option id (highlighted)"),
      allowOther: z.boolean().optional().describe("Allow custom 'other' input"),
    },
    validate: requireOptions,
    toConfig: (args) => ({
      question: args.question,
      options: args.options,
      recommended: args.recommended,
      allowOther: args.allowOther,
    }),
  });
}

function buildPickManyTool(sessions: SessionStore): OcttoTool {
  const createTool = createQuestionToolFactory(sessions);
  return createTool<PickManyConfig & { session_id: string }>({
    type: "pick_many",
    description: `Ask user to select MULTIPLE options from a list.
Response format: { selected: string[] } where selected is array of chosen option ids.`,
    args: {
      question: z.string().describe(DESC_QUESTION),
      options: optionsSchema,
      recommended: z.array(z.string()).optional().describe("Recommended option ids"),
      min: z.number().optional().describe("Minimum selections required"),
      max: z.number().optional().describe("Maximum selections allowed"),
      allowOther: z.boolean().optional().describe("Allow custom 'other' input"),
    },
    validate: (args) => {
      if (!args.options || args.options.length === 0) return ERR_OPTIONS_EMPTY;
      if (args.min !== undefined && args.max !== undefined && args.min > args.max) {
        return `min (${args.min}) cannot be greater than max (${args.max})`;
      }
      return null;
    },
    toConfig: (args) => ({
      question: args.question,
      options: args.options,
      recommended: args.recommended,
      min: args.min,
      max: args.max,
      allowOther: args.allowOther,
    }),
  });
}

function buildConfirmTool(sessions: SessionStore): OcttoTool {
  const createTool = createQuestionToolFactory(sessions);
  return createTool<ConfirmConfig & { session_id: string }>({
    type: "confirm",
    description: `Ask user for Yes/No confirmation.
Response format: { choice: "yes" | "no" | "cancel" }`,
    args: {
      question: z.string().describe(DESC_QUESTION),
      context: z.string().optional().describe("Additional context/details"),
      yesLabel: z.string().optional().describe("Custom label for yes button"),
      noLabel: z.string().optional().describe("Custom label for no button"),
      allowCancel: z.boolean().optional().describe("Show cancel option"),
    },
    toConfig: (args) => ({
      question: args.question,
      context: args.context,
      yesLabel: args.yesLabel,
      noLabel: args.noLabel,
      allowCancel: args.allowCancel,
    }),
  });
}

function buildRankTool(sessions: SessionStore): OcttoTool {
  const createTool = createQuestionToolFactory(sessions);
  return createTool<RankConfig & { session_id: string }>({
    type: "rank",
    description: `Ask user to rank/order items by dragging.
Response format: { ranked: string[] } where ranked is array of option ids in user's order (first = highest).`,
    args: {
      question: z.string().describe(DESC_QUESTION),
      options: optionsSchema.describe("Items to rank"),
      context: z.string().optional().describe(DESC_CONTEXT),
    },
    validate: requireOptions,
    toConfig: (args) => ({
      question: args.question,
      options: args.options,
      context: args.context,
    }),
  });
}

function buildRateTool(sessions: SessionStore): OcttoTool {
  const createTool = createQuestionToolFactory(sessions);
  return createTool<RateConfig & { session_id: string }>({
    type: "rate",
    description: `Ask user to rate items on a numeric scale.
Response format: { ratings: Record<string, number> } where key is option id, value is rating.`,
    args: {
      question: z.string().describe(DESC_QUESTION),
      options: optionsSchema.describe("Items to rate"),
      min: z.number().optional().describe("Minimum rating value (default: 1)"),
      max: z.number().optional().describe("Maximum rating value (default: 5)"),
      step: z.number().optional().describe("Rating step (default: 1)"),
      labels: z
        .object({
          min: z.string().optional().describe("Label for minimum value"),
          max: z.string().optional().describe("Label for maximum value"),
        })
        .optional()
        .describe("Optional labels for min/max"),
    },
    validate: (args) => {
      if (!args.options || args.options.length === 0) return ERR_OPTIONS_EMPTY;
      const min = args.min ?? 1;
      const max = args.max ?? DEFAULT_RATING_MAX;
      if (min >= max) return `min (${min}) must be less than max (${max})`;
      return null;
    },
    toConfig: (args) => ({
      question: args.question,
      options: args.options,
      min: args.min ?? 1,
      max: args.max ?? DEFAULT_RATING_MAX,
      step: args.step,
      labels: args.labels,
    }),
  });
}

export function createQuestionTools(sessions: SessionStore): OcttoTools {
  return {
    pick_one: buildPickOneTool(sessions),
    pick_many: buildPickManyTool(sessions),
    confirm: buildConfirmTool(sessions),
    rank: buildRankTool(sessions),
    rate: buildRateTool(sessions),
    ...createInputTools(sessions),
    ...createPresentationTools(sessions),
    ...createQuickTools(sessions),
  };
}

// Input tool interfaces
interface TextConfig {
  session_id: string;
  question: string;
  placeholder?: string;
  context?: string;
  multiline?: boolean;
  minLength?: number;
  maxLength?: number;
}

interface ImageConfig {
  session_id: string;
  question: string;
  context?: string;
  multiple?: boolean;
  maxImages?: number;
  accept?: string[];
}

interface FileConfig {
  session_id: string;
  question: string;
  context?: string;
  multiple?: boolean;
  maxFiles?: number;
  accept?: string[];
  maxSize?: number;
}

interface CodeConfig {
  session_id: string;
  question: string;
  context?: string;
  language?: string;
  placeholder?: string;
}

function buildAskTextTool(sessions: SessionStore): OcttoTool {
  const createTool = createQuestionToolFactory(sessions);
  return createTool<TextConfig>({
    type: "ask_text",
    description: `Ask user for text input (single or multi-line).
Response format: { text: string }`,
    args: {
      question: z.string().describe(DESC_QUESTION),
      placeholder: z.string().optional().describe("Placeholder text"),
      context: z.string().optional().describe(DESC_CONTEXT),
      multiline: z.boolean().optional().describe("Multi-line input (default: false)"),
      minLength: z.number().optional().describe("Minimum text length"),
      maxLength: z.number().optional().describe("Maximum text length"),
    },
    toConfig: (args) => ({
      question: args.question,
      placeholder: args.placeholder,
      context: args.context,
      multiline: args.multiline,
      minLength: args.minLength,
      maxLength: args.maxLength,
    }),
  });
}

function buildAskImageTool(sessions: SessionStore): OcttoTool {
  const createTool = createQuestionToolFactory(sessions);
  return createTool<ImageConfig>({
    type: "ask_image",
    description: "Ask user to upload/paste image(s).",
    args: {
      question: z.string().describe(DESC_QUESTION),
      context: z.string().optional().describe(DESC_CONTEXT),
      multiple: z.boolean().optional().describe("Allow multiple images"),
      maxImages: z.number().optional().describe("Maximum number of images"),
      accept: z.array(z.string()).optional().describe("Allowed image types"),
    },
    toConfig: (args) => ({
      question: args.question,
      context: args.context,
      multiple: args.multiple,
      maxImages: args.maxImages,
      accept: args.accept,
    }),
  });
}

function buildAskFileTool(sessions: SessionStore): OcttoTool {
  const createTool = createQuestionToolFactory(sessions);
  return createTool<FileConfig>({
    type: "ask_file",
    description: "Ask user to upload file(s).",
    args: {
      question: z.string().describe(DESC_QUESTION),
      context: z.string().optional().describe(DESC_CONTEXT),
      multiple: z.boolean().optional().describe("Allow multiple files"),
      maxFiles: z.number().optional().describe("Maximum number of files"),
      accept: z.array(z.string()).optional().describe("Allowed file types"),
      maxSize: z.number().optional().describe("Maximum file size in bytes"),
    },
    toConfig: (args) => ({
      question: args.question,
      context: args.context,
      multiple: args.multiple,
      maxFiles: args.maxFiles,
      accept: args.accept,
      maxSize: args.maxSize,
    }),
  });
}

function buildAskCodeTool(sessions: SessionStore): OcttoTool {
  const createTool = createQuestionToolFactory(sessions);
  return createTool<CodeConfig>({
    type: "ask_code",
    description: "Ask user for code input with syntax highlighting.",
    args: {
      question: z.string().describe(DESC_QUESTION),
      context: z.string().optional().describe(DESC_CONTEXT),
      language: z.string().optional().describe("Programming language for highlighting"),
      placeholder: z.string().optional().describe("Placeholder code"),
    },
    toConfig: (args) => ({
      question: args.question,
      context: args.context,
      language: args.language,
      placeholder: args.placeholder,
    }),
  });
}

function createInputTools(sessions: SessionStore): OcttoTools {
  return {
    ask_text: buildAskTextTool(sessions),
    ask_image: buildAskImageTool(sessions),
    ask_file: buildAskFileTool(sessions),
    ask_code: buildAskCodeTool(sessions),
  };
}

// Presentation tool interfaces
interface DiffConfig {
  session_id: string;
  question: string;
  before: string;
  after: string;
  filePath?: string;
  language?: string;
}

interface PlanConfig {
  session_id: string;
  question: string;
  sections?: Array<{ id: string; title: string; content: string }>;
  markdown?: string;
}

interface ShowOptionsConfig {
  session_id: string;
  question: string;
  options: Array<{ id: string; label: string; description?: string; pros?: string[]; cons?: string[] }>;
  recommended?: string;
  allowFeedback?: boolean;
}

interface ReviewConfig {
  session_id: string;
  question: string;
  content: string;
  context?: string;
}

const sectionSchema = z.array(
  z.object({
    id: z.string().describe("Section identifier"),
    title: z.string().describe("Section title"),
    content: z.string().describe("Section content (markdown)"),
  }),
);

const prosConsOptionSchema = z.array(
  z.object({
    id: z.string().describe("Unique option identifier"),
    label: z.string().describe("Display label"),
    description: z.string().optional().describe("Optional description"),
    pros: z.array(z.string()).optional().describe("Advantages"),
    cons: z.array(z.string()).optional().describe("Disadvantages"),
  }),
);

function buildShowDiffTool(sessions: SessionStore): OcttoTool {
  const createTool = createQuestionToolFactory(sessions);
  return createTool<DiffConfig>({
    type: "show_diff",
    description: "Show a diff and ask user to approve/reject/edit.",
    args: {
      question: z.string().describe("Title/description of the change"),
      before: z.string().describe("Original content"),
      after: z.string().describe("Modified content"),
      filePath: z.string().optional().describe("File path for context"),
      language: z.string().optional().describe("Language for syntax highlighting"),
    },
    toConfig: (args) => ({
      question: args.question,
      before: args.before,
      after: args.after,
      filePath: args.filePath,
      language: args.language,
    }),
  });
}

function buildShowPlanTool(sessions: SessionStore): OcttoTool {
  const createTool = createQuestionToolFactory(sessions);
  return createTool<PlanConfig>({
    type: "show_plan",
    description: `Show a plan/document for user review with annotations.
Response format: { approved: boolean, annotations?: Record<sectionId, string> }`,
    args: {
      question: z.string().describe("Plan title"),
      sections: sectionSchema.optional().describe("Plan sections"),
      markdown: z.string().optional().describe("Full markdown (alternative to sections)"),
    },
    toConfig: (args) => ({
      question: args.question,
      sections: args.sections,
      markdown: args.markdown,
    }),
  });
}

function buildShowOptionsTool(sessions: SessionStore): OcttoTool {
  const createTool = createQuestionToolFactory(sessions);
  return createTool<ShowOptionsConfig>({
    type: "show_options",
    description: `Show options with pros/cons for user to select.
Response format: { selected: string, feedback?: string } where selected is the chosen option id.`,
    args: {
      question: z.string().describe(DESC_QUESTION),
      options: prosConsOptionSchema.describe("Options with pros/cons"),
      recommended: z.string().optional().describe("Recommended option id"),
      allowFeedback: z.boolean().optional().describe("Allow text feedback with selection"),
    },
    validate: (args) => {
      if (!args.options || args.options.length === 0) return ERR_OPTIONS_EMPTY;
      return null;
    },
    toConfig: (args) => ({
      question: args.question,
      options: args.options,
      recommended: args.recommended,
      allowFeedback: args.allowFeedback,
    }),
  });
}

function buildReviewSectionTool(sessions: SessionStore): OcttoTool {
  const createTool = createQuestionToolFactory(sessions);
  return createTool<ReviewConfig>({
    type: "review_section",
    description: "Show content section for user review with inline feedback.",
    args: {
      question: z.string().describe("Section title"),
      content: z.string().describe("Section content (markdown)"),
      context: z.string().optional().describe("Context about what to review"),
    },
    toConfig: (args) => ({
      question: args.question,
      content: args.content,
      context: args.context,
    }),
  });
}

function createPresentationTools(sessions: SessionStore): OcttoTools {
  return {
    show_diff: buildShowDiffTool(sessions),
    show_plan: buildShowPlanTool(sessions),
    show_options: buildShowOptionsTool(sessions),
    review_section: buildReviewSectionTool(sessions),
  };
}

// Quick tool interfaces
interface ThumbsConfig {
  session_id: string;
  question: string;
  context?: string;
}

interface EmojiConfig {
  session_id: string;
  question: string;
  context?: string;
  emojis?: string[];
}

interface SliderConfig {
  session_id: string;
  question: string;
  min: number;
  max: number;
  step?: number;
  defaultValue?: number;
  context?: string;
  labels?: { min?: string; max?: string; mid?: string };
}

function buildThumbsTool(sessions: SessionStore): OcttoTool {
  const createTool = createQuestionToolFactory(sessions);
  return createTool<ThumbsConfig>({
    type: "thumbs",
    description: `Ask user for quick thumbs up/down feedback.
Response format: { choice: "up" | "down" }`,
    args: {
      question: z.string().describe(DESC_QUESTION),
      context: z.string().optional().describe("Context to show"),
    },
    toConfig: (args) => ({
      question: args.question,
      context: args.context,
    }),
  });
}

function buildEmojiReactTool(sessions: SessionStore): OcttoTool {
  const createTool = createQuestionToolFactory(sessions);
  return createTool<EmojiConfig>({
    type: "emoji_react",
    description: "Ask user to react with an emoji.",
    args: {
      question: z.string().describe(DESC_QUESTION),
      context: z.string().optional().describe("Context to show"),
      emojis: z.array(z.string()).optional().describe("Available emoji options"),
    },
    toConfig: (args) => ({
      question: args.question,
      context: args.context,
      emojis: args.emojis,
    }),
  });
}

function buildSliderTool(sessions: SessionStore): OcttoTool {
  const createTool = createQuestionToolFactory(sessions);
  return createTool<SliderConfig>({
    type: "slider",
    description: `Ask user to select a value on a numeric slider.
Response format: { value: number }`,
    args: {
      question: z.string().describe(DESC_QUESTION),
      min: z.number().describe("Minimum value"),
      max: z.number().describe("Maximum value"),
      step: z.number().optional().describe("Step size (default: 1)"),
      defaultValue: z.number().optional().describe("Default value"),
      context: z.string().optional().describe(DESC_CONTEXT),
      labels: z
        .object({
          min: z.string().optional().describe("Label for minimum value"),
          max: z.string().optional().describe("Label for maximum value"),
          mid: z.string().optional().describe("Label for middle value"),
        })
        .optional()
        .describe("Optional labels for the slider"),
    },
    validate: (args) => {
      if (args.min >= args.max) return `min (${args.min}) must be less than max (${args.max})`;
      return null;
    },
    toConfig: (args) => ({
      question: args.question,
      min: args.min,
      max: args.max,
      step: args.step,
      defaultValue: args.defaultValue,
      context: args.context,
      labels: args.labels,
    }),
  });
}

function createQuickTools(sessions: SessionStore): OcttoTools {
  return {
    thumbs: buildThumbsTool(sessions),
    emoji_react: buildEmojiReactTool(sessions),
    slider: buildSliderTool(sessions),
  };
}
