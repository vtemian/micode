// src/octto/session/server.ts

import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import * as v from "valibot";
import { type WebSocket, WebSocketServer } from "ws";
import { getHtmlBundle } from "@/octto/ui";
import { config } from "@/utils/config";
import { extractErrorMessage } from "@/utils/errors";
import { log } from "@/utils/logger";
import { WsClientMessageSchema } from "./schemas";
import type { SessionServer, SessionSocket, SocketRouter, WsClientMessage } from "./types";

const WS_PATH = "/ws";
const HTML_PATHS = new Set(["/", "/index.html"]);
const LOOPBACK = "127.0.0.1";
const LOG_MODULE = "octto";
const ERR_NO_PORT = "Failed to get server port";
const STATUS_OK = 200;
const STATUS_NOT_FOUND = 404;

function serveHttp(req: IncomingMessage, res: ServerResponse, htmlBundle: string): void {
  const path = (req.url ?? "").split("?")[0];

  if (HTML_PATHS.has(path)) {
    res.writeHead(STATUS_OK, { "Content-Type": "text/html; charset=utf-8" });
    res.end(htmlBundle);
    return;
  }

  res.writeHead(STATUS_NOT_FOUND, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not Found");
}

function sendError(socket: SessionSocket, error: string, details: string): void {
  socket.send(JSON.stringify({ type: "error", error, details }));
}

function handleWsMessage(socket: SessionSocket, sessionId: string, raw: string, store: SocketRouter): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    log.error(LOG_MODULE, "Failed to parse WebSocket message", error);
    sendError(socket, "Invalid message format", extractErrorMessage(error));
    return;
  }

  const result = v.safeParse(WsClientMessageSchema, parsed);
  if (!result.success) {
    log.error(LOG_MODULE, "Invalid WebSocket message schema", result.issues);
    sendError(socket, "Invalid message schema", result.issues.map((issue) => issue.message).join("; "));
    return;
  }

  store.handleWsMessage(sessionId, result.output as WsClientMessage);
}

function attachWebSockets(wss: WebSocketServer, sessionId: string, store: SocketRouter): void {
  wss.on("connection", (socket: WebSocket) => {
    store.handleWsConnect(sessionId, socket);

    socket.on("message", (data: Buffer | string) => {
      handleWsMessage(socket, sessionId, data.toString(), store);
    });
    socket.on("close", () => {
      store.handleWsDisconnect(sessionId);
    });
    socket.on("error", (error: unknown) => {
      log.error(LOG_MODULE, "WebSocket connection error", error);
    });
  });
}

// ws attaches its own listener to the HTTP server and re-emits its errors on
// itself, so the only handler that sees a bind failure is one registered here.
// Without it an unhandled 'error' propagates out and takes the host process
// down with the session.
function listen(http: Server, wss: WebSocketServer, hostname: string): Promise<number> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (finish: () => void): void => {
      if (settled) return;
      settled = true;
      finish();
    };

    wss.on("error", (error) => {
      log.error(LOG_MODULE, "WebSocket server error", error);
      settle(() => {
        reject(error);
      });
    });

    http.listen(0, hostname, () => {
      const address = http.address();
      if (address === null || typeof address === "string") {
        settle(() => {
          reject(new Error(ERR_NO_PORT));
        });
        return;
      }
      settle(() => {
        resolve(address.port);
      });
    });
  });
}

// Live sockets keep node:http from closing, so drop them before waiting.
function stop(http: Server, wss: WebSocketServer): Promise<void> {
  return new Promise((resolve) => {
    for (const client of wss.clients) {
      client.terminate();
    }
    wss.close(() => {
      // Absent before Node 18.2, which older Electron builds still ship. An
      // unguarded call throws inside ws's close callback and strands stop().
      http.closeAllConnections?.();
      http.close(() => {
        resolve();
      });
    });
  });
}

export async function createServer(
  sessionId: string,
  store: SocketRouter,
): Promise<{ server: SessionServer; port: number }> {
  const htmlBundle = getHtmlBundle();
  const hostname = config.octto.allowRemoteBind ? config.octto.bindAddress : LOOPBACK;

  const http = createHttpServer((req, res) => {
    serveHttp(req, res, htmlBundle);
  });
  const wss = new WebSocketServer({ server: http, path: WS_PATH, maxPayload: config.octto.maxFrameBytes });
  attachWebSockets(wss, sessionId, store);

  const port = await listen(http, wss, hostname);

  return {
    port,
    server: { port, hostname, stop: () => stop(http, wss) },
  };
}
