// tests/octto/server.test.ts
// Exercises the real HTTP + WebSocket server against real client connections.
import { afterEach, describe, expect, it } from "bun:test";

import { createServer } from "../../src/octto/session/server";
import type { SessionServer, SessionSocket, WsClientMessage } from "../../src/octto/session/types";
import { captureLogs, type LogCapture } from "../helpers/log-capture";

const SESSION_ID = "test-session";

interface Recorded {
  connects: SessionSocket[];
  disconnects: string[];
  messages: WsClientMessage[];
}

function createRecordingStore(): { store: Parameters<typeof createServer>[1]; recorded: Recorded } {
  const recorded: Recorded = { connects: [], disconnects: [], messages: [] };
  const store = {
    handleWsConnect: (_sessionId: string, socket: SessionSocket) => {
      recorded.connects.push(socket);
    },
    handleWsDisconnect: (sessionId: string) => {
      recorded.disconnects.push(sessionId);
    },
    handleWsMessage: (_sessionId: string, message: WsClientMessage) => {
      recorded.messages.push(message);
    },
  };
  return { store: store as unknown as Parameters<typeof createServer>[1], recorded };
}

function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = (): void => {
      if (predicate()) {
        resolve();
        return;
      }
      if (Date.now() - started > timeoutMs) {
        reject(new Error("condition not met in time"));
        return;
      }
      setTimeout(tick, 10);
    };
    tick();
  });
}

function connect(port: number): Promise<WebSocket> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  return new Promise((resolve, reject) => {
    socket.addEventListener("open", () => {
      resolve(socket);
    });
    socket.addEventListener("error", () => {
      reject(new Error("websocket failed to open"));
    });
  });
}

describe("octto session server", () => {
  let server: SessionServer | undefined;
  let logs: LogCapture | undefined;

  afterEach(async () => {
    logs?.restore();
    logs = undefined;
    await server?.stop();
    server = undefined;
  });

  it("serves the html bundle on / and 404s unknown paths", async () => {
    const { store } = createRecordingStore();
    const started = await createServer(SESSION_ID, store);
    server = started.server;

    const page = await fetch(`http://127.0.0.1:${started.port}/`);
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toContain("text/html");
    expect((await page.text()).length).toBeGreaterThan(0);

    const missing = await fetch(`http://127.0.0.1:${started.port}/nope`);
    expect(missing.status).toBe(404);
  });

  it("reports a real bound port", async () => {
    const { store } = createRecordingStore();
    const started = await createServer(SESSION_ID, store);
    server = started.server;

    expect(started.port).toBeGreaterThan(0);
    expect(started.server.hostname).toBe("127.0.0.1");
  });

  it("routes a websocket connect, message and disconnect to the store", async () => {
    const { store, recorded } = createRecordingStore();
    const started = await createServer(SESSION_ID, store);
    server = started.server;

    const client = await connect(started.port);
    await waitFor(() => recorded.connects.length === 1);

    client.send(JSON.stringify({ type: "response", id: "q1", answer: { value: "yes" } }));
    await waitFor(() => recorded.messages.length === 1);
    expect(recorded.messages[0]).toMatchObject({ type: "response", id: "q1" });

    client.close();
    await waitFor(() => recorded.disconnects.length === 1);
    expect(recorded.disconnects[0]).toBe(SESSION_ID);
  });

  it("answers malformed json with an error frame instead of dropping the socket", async () => {
    logs = captureLogs();
    const { store, recorded } = createRecordingStore();
    const started = await createServer(SESSION_ID, store);
    server = started.server;

    const client = await connect(started.port);
    await waitFor(() => recorded.connects.length === 1);

    const received: string[] = [];
    client.addEventListener("message", (event: MessageEvent) => {
      received.push(String(event.data));
    });

    client.send("not json at all");
    await waitFor(() => received.length === 1);

    expect(JSON.parse(received[0])).toMatchObject({ type: "error", error: "Invalid message format" });
    expect(recorded.messages).toHaveLength(0);
    expect(logs.error.some((line) => line.includes("Failed to parse WebSocket message"))).toBe(true);

    client.close();
  });

  it("rejects a well-formed message that fails schema validation", async () => {
    logs = captureLogs();
    const { store, recorded } = createRecordingStore();
    const started = await createServer(SESSION_ID, store);
    server = started.server;

    const client = await connect(started.port);
    await waitFor(() => recorded.connects.length === 1);

    const received: string[] = [];
    client.addEventListener("message", (event: MessageEvent) => {
      received.push(String(event.data));
    });

    client.send(JSON.stringify({ type: "definitely-not-a-real-message" }));
    await waitFor(() => received.length === 1);

    expect(JSON.parse(received[0])).toMatchObject({ type: "error", error: "Invalid message schema" });
    expect(recorded.messages).toHaveLength(0);

    client.close();
  });

  it("stops cleanly while a client is still connected", async () => {
    const { store, recorded } = createRecordingStore();
    const started = await createServer(SESSION_ID, store);

    const client = await connect(started.port);
    await waitFor(() => recorded.connects.length === 1);

    await started.server.stop();
    server = undefined;

    await expect(fetch(`http://127.0.0.1:${started.port}/`)).rejects.toThrow();
    client.close();
  });
});
