export interface BackgroundTask {
  id: string;
  sessionID: string;
  parentSessionID: string;
  parentMessageID: string;
  description: string;
  prompt: string;
  agent: string;
  status: "running" | "completed" | "error" | "cancelled";
  startedAt: Date;
  completedAt?: Date;
  result?: string;
  error?: string;
  progress?: {
    toolCalls: number;
    lastTool?: string;
    lastUpdate: Date;
  };
}

export interface BackgroundTaskInput {
  description: string;
  prompt: string;
  agent: string;
  parentSessionID: string;
  parentMessageID: string;
}

// API Response Types
export interface SessionCreateResponse {
  data?: {
    id?: string;
  };
}

export interface SessionGetResponse {
  data?: {
    status?: "idle" | "running" | "error";
  };
}

export interface MessagePart {
  type: string;
  text?: string;
}

export interface MessageInfo {
  role?: "user" | "assistant";
  sessionID?: string;
  type?: string;
  name?: string;
}

export interface SessionMessage {
  info?: MessageInfo;
  parts?: MessagePart[];
}

export interface SessionMessagesResponse {
  data?: SessionMessage[];
}
