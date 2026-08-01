// tests/octto/server.test.ts
// Exercises the real HTTP + WebSocket server against real client connections.
import { afterEach, describe, expect, it } from "bun:test";
import { connect as netConnect } from "node:net";

import { createServer } from "../../src/octto/session/server";
import type { SessionServer, SessionSocket, SocketRouter, WsClientMessage } from "../../src/octto/session/types";
import { captureLogs, type LogCapture } from "../helpers/log-capture";

const SESSION_ID = "test-session";
const POLL_TIMEOUT_MS = 2000;
const POLL_INTERVAL_MS = 10;
const HANDSHAKE_TIMEOUT_MS = 4000;

interface Recorded {
  connects: { sessionId: string; socket: SessionSocket }[];
  disconnects: string[];
  messages: { sessionId: string; message: WsClientMessage }[];
}

function createRecordingRouter(): { router: SocketRouter; recorded: Recorded } {
  const recorded: Recorded = { connects: [], disconnects: [], messages: [] };
  const router: SocketRouter = {
    handleWsConnect: (sessionId, socket) => {
      recorded.connects.push({ sessionId, socket });
    },
    handleWsDisconnect: (sessionId) => {
      recorded.disconnects.push(sessionId);
    },
    handleWsMessage: (sessionId, message) => {
      recorded.messages.push({ sessionId, message });
    },
  };
  return { router, recorded };
}

function waitFor(describeCondition: string, predicate: () => boolean): Promise<void> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = (): void => {
      if (predicate()) {
        resolve();
        return;
      }
      if (Date.now() - started > POLL_TIMEOUT_MS) {
        reject(new Error(`timed out waiting for: ${describeCondition}`));
        return;
      }
      setTimeout(tick, POLL_INTERVAL_MS);
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

/** Raw upgrade request, so we can see the status line for non-/ws paths. */
function rawUpgrade(port: number, path: string): Promise<string> {
  return new Promise((resolve) => {
    const socket = netConnect(port, "127.0.0.1", () => {
      socket.write(
        `GET ${path} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n` +
          `Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`,
      );
    });
    socket.on("data", (chunk) => {
      resolve(chunk.toString().split("\r\n")[0]);
      socket.destroy();
    });
    setTimeout(() => {
      resolve("*** no response ***");
      socket.destroy();
    }, HANDSHAKE_TIMEOUT_MS);
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

  async function start(): Promise<{ port: number; recorded: Recorded }> {
    const { router, recorded } = createRecordingRouter();
    const started = await createServer(SESSION_ID, router);
    server = started.server;
    return { port: started.port, recorded };
  }

  it("serves the html bundle on / and on /index.html", async () => {
    const { port } = await start();

    for (const path of ["/", "/index.html", "/?theme=dark"]) {
      const page = await fetch(`http://127.0.0.1:${port}${path}`);
      expect(page.status).toBe(200);
      expect(page.headers.get("content-type")).toContain("text/html");
      expect((await page.text()).length).toBeGreaterThan(0);
    }
  });

  it("404s an unknown path", async () => {
    const { port } = await start();
    const missing = await fetch(`http://127.0.0.1:${port}/nope`);
    expect(missing.status).toBe(404);
  });

  it("reports the bound port and host it actually listened on", async () => {
    const { port } = await start();

    expect(server?.hostname).toBe("127.0.0.1");
    expect(server?.port).toBe(port);
    const page = await fetch(`http://127.0.0.1:${port}/`);
    expect(page.status).toBe(200);
  });

  it("refuses a websocket upgrade outside /ws", async () => {
    const { port } = await start();

    expect(await rawUpgrade(port, "/ws")).toContain("101");
    expect(await rawUpgrade(port, "/other")).toContain("400");
  });

  it("routes a websocket connect, message and disconnect to the router", async () => {
    const { port, recorded } = await start();

    const client = await connect(port);
    await waitFor("connect recorded", () => recorded.connects.length === 1);
    expect(recorded.connects[0].sessionId).toBe(SESSION_ID);

    client.send(JSON.stringify({ type: "response", id: "q1", answer: { value: "yes" } }));
    await waitFor("message recorded", () => recorded.messages.length === 1);
    expect(recorded.messages[0].sessionId).toBe(SESSION_ID);
    expect(recorded.messages[0].message).toMatchObject({ type: "response", id: "q1" });

    client.close();
    await waitFor("disconnect recorded", () => recorded.disconnects.length === 1);
    expect(recorded.disconnects[0]).toBe(SESSION_ID);
  });

  it("answers malformed json with an error frame and logs it", async () => {
    logs = captureLogs();
    const { port, recorded } = await start();

    const client = await connect(port);
    await waitFor("connect recorded", () => recorded.connects.length === 1);

    const received: string[] = [];
    client.addEventListener("message", (event: MessageEvent) => {
      received.push(String(event.data));
    });

    client.send("not json at all");
    await waitFor("error frame received", () => received.length === 1);

    expect(JSON.parse(received[0])).toMatchObject({ type: "error", error: "Invalid message format" });
    expect(recorded.messages).toHaveLength(0);
    expect(logs.error).toHaveLength(1);
    expect(logs.error[0]).toContain("[octto] Failed to parse WebSocket message");

    client.close();
  });

  it("rejects a well-formed message that fails schema validation and logs it", async () => {
    logs = captureLogs();
    const { port, recorded } = await start();

    const client = await connect(port);
    await waitFor("connect recorded", () => recorded.connects.length === 1);

    const received: string[] = [];
    client.addEventListener("message", (event: MessageEvent) => {
      received.push(String(event.data));
    });

    client.send(JSON.stringify({ type: "definitely-not-a-real-message" }));
    await waitFor("error frame received", () => received.length === 1);

    const frame = JSON.parse(received[0]);
    expect(frame).toMatchObject({ type: "error", error: "Invalid message schema" });
    expect(frame.details.length).toBeGreaterThan(0);
    expect(recorded.messages).toHaveLength(0);
    expect(logs.error).toHaveLength(1);
    expect(logs.error[0]).toContain("[octto] Invalid WebSocket message schema");

    client.close();
  });

  it("stops cleanly while a client is still connected", async () => {
    const { port, recorded } = await start();

    const client = await connect(port);
    await waitFor("connect recorded", () => recorded.connects.length === 1);

    // Deliberately not clearing `server` until stop() has resolved, so a
    // failure here still leaves afterEach able to release the port.
    await server?.stop();
    await expect(fetch(`http://127.0.0.1:${port}/`)).rejects.toThrow();

    client.close();
  });

  it("tolerates stop() being called more than once", async () => {
    const { port } = await start();
    expect((await fetch(`http://127.0.0.1:${port}/`)).status).toBe(200);

    await server?.stop();
    await server?.stop();
  });
});
