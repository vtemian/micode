// src/octto/session/schemas.ts
import * as v from "valibot";

// Answer is a loosely-structured union coming from the browser.
// We validate the structural envelope (type + id) and pass the answer
// through so existing runtime code keeps working without duplicating
// every answer variant here.
const AnswerSchema = v.record(v.string(), v.unknown());

const WsResponseMessageSchema = v.object({
  type: v.literal("response"),
  id: v.string(),
  answer: AnswerSchema,
});

const WsConnectedMessageSchema = v.object({
  type: v.literal("connected"),
});

export const WsClientMessageSchema = v.variant("type", [WsResponseMessageSchema, WsConnectedMessageSchema]);
