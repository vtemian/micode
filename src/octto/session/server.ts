// src/octto/session/server.ts

import type { Server, ServerWebSocket } from "bun";
import * as v from "valibot";
import { getHtmlBundle } from "@/octto/ui";
import { config } from "@/utils/config";
import { extractErrorMessage } from "@/utils/errors";
import { log } from "@/utils/logger";
import { WsClientMessageSchema } from "./schemas";
import type { SessionStore } from "./sessions";
import type { WsClientMessage } from "./types";

interface WsData {
  sessionId: string;
}

export async function createServer(
  sessionId: string,
  store: SessionStore,
): Promise<{ server: Server<WsData>; port: number }> {
  const htmlBundle = getHtmlBundle();

  const server = Bun.serve<WsData>({
    port: 0, // Random available port
    hostname: config.octto.allowRemoteBind ? config.octto.bindAddress : "127.0.0.1",
    fetch(req, server) {
      return handleFetch(req, server, sessionId, htmlBundle);
    },
    websocket: createWebSocketHandlers(store),
  });

  // Port is always defined when using port: 0
  const port = server.port;
  if (port === undefined) {
    throw new Error("Failed to get server port");
  }

  return {
    server,
    port,
  };
}

function handleFetch(
  req: Request,
  server: Server<WsData>,
  sessionId: string,
  htmlBundle: string,
): Response | undefined {
  const url = new URL(req.url);

  // WebSocket upgrade
  if (url.pathname === "/ws") {
    const success = server.upgrade(req, {
      data: { sessionId },
    });
    if (success) {
      return undefined;
    }
    return new Response("WebSocket upgrade failed", { status: 400 });
  }

  // Serve the bundled HTML app
  if (url.pathname === "/" || url.pathname === "/index.html") {
    return new Response(htmlBundle, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
      },
    });
  }

  return new Response("Not Found", { status: 404 });
}

function createWebSocketHandlers(store: SessionStore): {
  open: (ws: ServerWebSocket<WsData>) => void;
  close: (ws: ServerWebSocket<WsData>) => void;
  message: (ws: ServerWebSocket<WsData>, message: string | Buffer) => void;
} {
  return {
    open(ws: ServerWebSocket<WsData>) {
      store.handleWsConnect(ws.data.sessionId, ws);
    },
    close(ws: ServerWebSocket<WsData>) {
      store.handleWsDisconnect(ws.data.sessionId);
    },
    message(ws: ServerWebSocket<WsData>, message: string | Buffer) {
      handleWsMessage(ws, message, store);
    },
  };
}

function handleWsMessage(ws: ServerWebSocket<WsData>, message: string | Buffer, store: SessionStore): void {
  const { sessionId } = ws.data;

  let raw: unknown;
  try {
    raw = JSON.parse(message.toString());
  } catch (error) {
    log.error("octto", "Failed to parse WebSocket message", error);
    ws.send(
      JSON.stringify({
        type: "error",
        error: "Invalid message format",
        details: extractErrorMessage(error),
      }),
    );
    return;
  }

  const result = v.safeParse(WsClientMessageSchema, raw);
  if (!result.success) {
    log.error("octto", "Invalid WebSocket message schema", result.issues);
    ws.send(
      JSON.stringify({
        type: "error",
        error: "Invalid message schema",
        details: result.issues.map((i) => i.message).join("; "),
      }),
    );
    return;
  }

  store.handleWsMessage(sessionId, result.output as WsClientMessage);
}
