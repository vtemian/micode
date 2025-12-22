import { spawn, type Subprocess } from "bun";
import { readFileSync, existsSync } from "fs";
import { extname, resolve } from "path";

// Language server configurations
const SERVERS: Record<string, { command: string[]; extensions: string[]; languageId: string }> = {
  typescript: {
    command: ["npx", "typescript-language-server", "--stdio"],
    extensions: [".ts", ".tsx", ".js", ".jsx"],
    languageId: "typescript",
  },
  python: {
    command: ["pylsp"],
    extensions: [".py"],
    languageId: "python",
  },
  rust: {
    command: ["rust-analyzer"],
    extensions: [".rs"],
    languageId: "rust",
  },
  go: {
    command: ["gopls"],
    extensions: [".go"],
    languageId: "go",
  },
};

function getServerForFile(filePath: string): typeof SERVERS[string] | null {
  const ext = extname(filePath).toLowerCase();
  for (const server of Object.values(SERVERS)) {
    if (server.extensions.includes(ext)) return server;
  }
  return null;
}

export class LSPClient {
  private proc: Subprocess<"pipe", "pipe", "pipe"> | null = null;
  private buffer = "";
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private requestId = 0;
  private openedFiles = new Set<string>();

  constructor(
    private root: string,
    private server: typeof SERVERS[string]
  ) {}

  async start(): Promise<void> {
    this.proc = spawn(this.server.command, {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      cwd: this.root,
    });

    this.readStdout();
    await this.initialize();
  }

  private readStdout(): void {
    if (!this.proc) return;

    const reader = this.proc.stdout.getReader();
    const decoder = new TextDecoder();

    const read = async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        this.buffer += decoder.decode(value);
        this.processBuffer();
      }
    };
    read();
  }

  private processBuffer(): void {
    while (true) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) break;

      const header = this.buffer.slice(0, headerEnd);
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) break;

      const len = parseInt(match[1], 10);
      const start = headerEnd + 4;
      if (this.buffer.length < start + len) break;

      const content = this.buffer.slice(start, start + len);
      this.buffer = this.buffer.slice(start + len);

      try {
        const msg = JSON.parse(content);
        if ("id" in msg && this.pending.has(msg.id)) {
          const handler = this.pending.get(msg.id)!;
          this.pending.delete(msg.id);
          if ("error" in msg) {
            handler.reject(new Error(msg.error.message));
          } else {
            handler.resolve(msg.result);
          }
        }
      } catch {}
    }
  }

  private send(method: string, params?: unknown): Promise<unknown> {
    if (!this.proc) throw new Error("LSP client not started");

    const id = ++this.requestId;
    const msg = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    const header = `Content-Length: ${Buffer.byteLength(msg)}\r\n\r\n`;
    this.proc.stdin.write(header + msg);

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`LSP request timeout: ${method}`));
        }
      }, 15000);
    });
  }

  private notify(method: string, params?: unknown): void {
    if (!this.proc) return;
    const msg = JSON.stringify({ jsonrpc: "2.0", method, params });
    this.proc.stdin.write(`Content-Length: ${Buffer.byteLength(msg)}\r\n\r\n${msg}`);
  }

  private async initialize(): Promise<void> {
    const rootUri = `file://${this.root}`;
    await this.send("initialize", {
      processId: process.pid,
      rootUri,
      capabilities: {
        textDocument: {
          hover: { contentFormat: ["markdown", "plaintext"] },
          definition: { linkSupport: true },
          references: {},
          documentSymbol: { hierarchicalDocumentSymbolSupport: true },
        },
        workspace: { symbol: {} },
      },
    });
    this.notify("initialized");
  }

  private async openFile(filePath: string): Promise<void> {
    const absPath = resolve(filePath);
    if (this.openedFiles.has(absPath)) return;

    const text = readFileSync(absPath, "utf-8");
    this.notify("textDocument/didOpen", {
      textDocument: {
        uri: `file://${absPath}`,
        languageId: this.server.languageId,
        version: 1,
        text,
      },
    });
    this.openedFiles.add(absPath);
    await new Promise((r) => setTimeout(r, 500));
  }

  async hover(filePath: string, line: number, character: number): Promise<unknown> {
    await this.openFile(filePath);
    return this.send("textDocument/hover", {
      textDocument: { uri: `file://${resolve(filePath)}` },
      position: { line: line - 1, character },
    });
  }

  async definition(filePath: string, line: number, character: number): Promise<unknown> {
    await this.openFile(filePath);
    return this.send("textDocument/definition", {
      textDocument: { uri: `file://${resolve(filePath)}` },
      position: { line: line - 1, character },
    });
  }

  async references(filePath: string, line: number, character: number): Promise<unknown> {
    await this.openFile(filePath);
    return this.send("textDocument/references", {
      textDocument: { uri: `file://${resolve(filePath)}` },
      position: { line: line - 1, character },
      context: { includeDeclaration: true },
    });
  }

  async documentSymbols(filePath: string): Promise<unknown> {
    await this.openFile(filePath);
    return this.send("textDocument/documentSymbol", {
      textDocument: { uri: `file://${resolve(filePath)}` },
    });
  }

  async workspaceSymbols(query: string): Promise<unknown> {
    return this.send("workspace/symbol", { query });
  }

  async diagnostics(filePath: string): Promise<unknown> {
    await this.openFile(filePath);
    // Wait a bit for diagnostics to be computed
    await new Promise((r) => setTimeout(r, 1000));
    return this.send("textDocument/diagnostic", {
      textDocument: { uri: `file://${resolve(filePath)}` },
    });
  }

  async prepareRename(filePath: string, line: number, character: number): Promise<unknown> {
    await this.openFile(filePath);
    return this.send("textDocument/prepareRename", {
      textDocument: { uri: `file://${resolve(filePath)}` },
      position: { line: line - 1, character },
    });
  }

  async rename(filePath: string, line: number, character: number, newName: string): Promise<unknown> {
    await this.openFile(filePath);
    return this.send("textDocument/rename", {
      textDocument: { uri: `file://${resolve(filePath)}` },
      position: { line: line - 1, character },
      newName,
    });
  }

  async codeActions(filePath: string, startLine: number, endLine: number): Promise<unknown> {
    await this.openFile(filePath);
    return this.send("textDocument/codeAction", {
      textDocument: { uri: `file://${resolve(filePath)}` },
      range: {
        start: { line: startLine - 1, character: 0 },
        end: { line: endLine - 1, character: 999 },
      },
      context: { diagnostics: [] },
    });
  }

  stop(): void {
    try {
      this.notify("shutdown");
      this.notify("exit");
    } catch {}
    this.proc?.kill();
    this.proc = null;
  }
}

// Client cache
const clients = new Map<string, LSPClient>();

export async function withLspClient<T>(
  filePath: string,
  root: string,
  fn: (client: LSPClient) => Promise<T>
): Promise<T> {
  const server = getServerForFile(filePath);
  if (!server) {
    throw new Error(`No LSP server configured for ${extname(filePath)} files`);
  }

  const key = `${root}::${server.command[0]}`;
  let client = clients.get(key);

  if (!client) {
    client = new LSPClient(root, server);
    await client.start();
    clients.set(key, client);
  }

  return fn(client);
}

export function stopAllClients(): void {
  for (const client of clients.values()) {
    client.stop();
  }
  clients.clear();
}
