// src/octto/session/types.ts
// Session and Question types for the octto module

import type {
  AskCodeConfig,
  AskFileConfig,
  AskImageConfig,
  AskTextConfig,
  ConfirmConfig,
  EmojiReactConfig,
  PickManyConfig,
  PickOneConfig,
  RankConfig,
  RateConfig,
  ReviewSectionConfig,
  ShowDiffConfig,
  ShowOptionsConfig,
  ShowPlanConfig,
  SliderConfig,
  ThumbsConfig,
} from "@/octto/types";

export const STATUSES = {
  PENDING: "pending",
  ANSWERED: "answered",
  CANCELLED: "cancelled",
  TIMEOUT: "timeout",
  NONE_PENDING: "none_pending",
} as const;

export type QuestionStatus = (typeof STATUSES)[Exclude<keyof typeof STATUSES, "NONE_PENDING">];

export interface Question {
  readonly id: string;
  readonly sessionId: string;
  readonly type: QuestionType;
  readonly config: BaseConfig;
  status: QuestionStatus;
  readonly createdAt: Date;
  answeredAt?: Date;
  response?: Answer;
  /** True if this answer was already returned via get_next_answer */
  retrieved?: boolean;
}

export const QUESTIONS = {
  PICK_ONE: "pick_one",
  PICK_MANY: "pick_many",
  CONFIRM: "confirm",
  RANK: "rank",
  RATE: "rate",
  ASK_TEXT: "ask_text",
  ASK_IMAGE: "ask_image",
  ASK_FILE: "ask_file",
  ASK_CODE: "ask_code",
  SHOW_DIFF: "show_diff",
  SHOW_PLAN: "show_plan",
  SHOW_OPTIONS: "show_options",
  REVIEW_SECTION: "review_section",
  THUMBS: "thumbs",
  EMOJI_REACT: "emoji_react",
  SLIDER: "slider",
} as const;

export type QuestionType = (typeof QUESTIONS)[keyof typeof QUESTIONS];
export const QUESTION_TYPES = Object.values(QUESTIONS);

// --- Answer Types ---

export interface PickOneAnswer {
  readonly selected: string;
}

export interface PickManyAnswer {
  readonly selected: string[];
}

export interface ConfirmAnswer {
  readonly choice: "yes" | "no" | "cancel";
}

export interface ThumbsAnswer {
  readonly choice: "up" | "down";
}

export interface EmojiReactAnswer {
  readonly emoji: string;
}

export interface AskTextAnswer {
  readonly text: string;
}

export interface SliderAnswer {
  readonly value: number;
}

export interface RankAnswer {
  readonly ranking: Array<{ id: string; rank: number }>;
}

export interface RateAnswer {
  readonly ratings: Record<string, number>;
}

export interface AskCodeAnswer {
  readonly code: string;
}

export interface AskImageAnswer {
  readonly images: Array<{ name: string; data: string; type: string }>;
}

export interface AskFileAnswer {
  readonly files: Array<{ name: string; data: string; type: string }>;
}

export interface ReviewAnswer {
  readonly decision: string;
  readonly feedback?: string;
}

export interface ShowOptionsAnswer {
  readonly selected: string;
  readonly feedback?: string;
}

export type Answer =
  | PickOneAnswer
  | PickManyAnswer
  | ConfirmAnswer
  | ThumbsAnswer
  | EmojiReactAnswer
  | AskTextAnswer
  | SliderAnswer
  | RankAnswer
  | RateAnswer
  | AskCodeAnswer
  | AskImageAnswer
  | AskFileAnswer
  | ReviewAnswer
  | ShowOptionsAnswer;

export interface QuestionAnswers {
  readonly [QUESTIONS.PICK_ONE]: PickOneAnswer;
  readonly [QUESTIONS.PICK_MANY]: PickManyAnswer;
  readonly [QUESTIONS.CONFIRM]: ConfirmAnswer;
  readonly [QUESTIONS.THUMBS]: ThumbsAnswer;
  readonly [QUESTIONS.EMOJI_REACT]: EmojiReactAnswer;
  readonly [QUESTIONS.ASK_TEXT]: AskTextAnswer;
  readonly [QUESTIONS.SLIDER]: SliderAnswer;
  readonly [QUESTIONS.RANK]: RankAnswer;
  readonly [QUESTIONS.RATE]: RateAnswer;
  readonly [QUESTIONS.ASK_CODE]: AskCodeAnswer;
  readonly [QUESTIONS.ASK_IMAGE]: AskImageAnswer;
  readonly [QUESTIONS.ASK_FILE]: AskFileAnswer;
  readonly [QUESTIONS.SHOW_DIFF]: ReviewAnswer;
  readonly [QUESTIONS.SHOW_PLAN]: ReviewAnswer;
  readonly [QUESTIONS.REVIEW_SECTION]: ReviewAnswer;
  readonly [QUESTIONS.SHOW_OPTIONS]: ShowOptionsAnswer;
}

export type QuestionConfig =
  | PickOneConfig
  | PickManyConfig
  | ConfirmConfig
  | RankConfig
  | RateConfig
  | AskTextConfig
  | AskImageConfig
  | AskFileConfig
  | AskCodeConfig
  | ShowDiffConfig
  | ShowPlanConfig
  | ShowOptionsConfig
  | ReviewSectionConfig
  | ThumbsConfig
  | EmojiReactConfig
  | SliderConfig;

/** Config type for transit - accepts both strict QuestionConfig and loose objects */
export type BaseConfig =
  | QuestionConfig
  | {
      question?: string;
      context?: string;
      [key: string]: unknown;
    };

/**
 * The websocket surface octto needs from whichever server runtime is hosting
 * it. Kept minimal so the implementation can be Bun's or Node's.
 */
export interface SessionSocket {
  send: (data: string) => void;
}

/** The HTTP server surface octto needs, independent of runtime. */
export interface SessionServer {
  readonly port: number;
  readonly hostname: string;
  stop: () => Promise<void>;
}

export interface Session {
  readonly id: string;
  readonly title?: string;
  readonly port: number;
  readonly url: string;
  readonly createdAt: Date;
  readonly questions: Map<string, Question>;
  wsConnected: boolean;
  readonly server?: SessionServer;
  wsClient?: SessionSocket;
}

export interface InitialQuestion {
  readonly type: QuestionType;
  readonly config: BaseConfig;
}

export interface StartSessionInput {
  readonly title?: string;
  /** Initial questions to display immediately when browser opens */
  readonly questions?: InitialQuestion[];
}

export interface StartSessionOutput {
  readonly session_id: string;
  readonly url: string;
  /** IDs of initial questions if any were provided */
  readonly question_ids?: string[];
}

export interface EndSessionOutput {
  readonly ok: boolean;
}

export interface PushQuestionOutput {
  readonly question_id: string;
}

export interface GetAnswerInput {
  readonly question_id: string;
  readonly block?: boolean;
  readonly timeout?: number;
}

export interface GetAnswerOutput {
  readonly completed: boolean;
  readonly status: QuestionStatus;
  readonly response?: Answer;
  readonly reason?: "timeout" | "cancelled" | "pending";
}

export interface GetNextAnswerInput {
  readonly session_id: string;
  readonly block?: boolean;
  readonly timeout?: number;
}

export type AnswerStatus = (typeof STATUSES)[keyof typeof STATUSES];

export interface GetNextAnswerOutput {
  readonly completed: boolean;
  readonly question_id?: string;
  readonly question_type?: QuestionType;
  readonly status: AnswerStatus;
  readonly response?: Answer;
  readonly reason?: typeof STATUSES.TIMEOUT | typeof STATUSES.NONE_PENDING;
}

export interface ListQuestionsOutput {
  readonly questions: Array<{
    readonly id: string;
    readonly type: QuestionType;
    readonly status: QuestionStatus;
    readonly createdAt: string;
    readonly answeredAt?: string;
  }>;
}

// WebSocket message types
export const WS_MESSAGES = {
  QUESTION: "question",
  CANCEL: "cancel",
  END: "end",
  RESPONSE: "response",
  CONNECTED: "connected",
} as const;

export interface WsQuestionMessage {
  readonly type: "question";
  readonly id: string;
  readonly questionType: QuestionType;
  readonly config: BaseConfig;
}

export interface WsCancelMessage {
  readonly type: "cancel";
  readonly id: string;
}

export interface WsEndMessage {
  readonly type: "end";
}

export interface WsResponseMessage {
  readonly type: "response";
  readonly id: string;
  readonly answer: Answer;
}

export interface WsConnectedMessage {
  readonly type: "connected";
}

export type WsServerMessage = WsQuestionMessage | WsCancelMessage | WsEndMessage;
export type WsClientMessage = WsResponseMessage | WsConnectedMessage;
