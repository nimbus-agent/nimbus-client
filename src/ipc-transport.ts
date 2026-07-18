/**
 * JSON-RPC 2.0 IPC client — Unix socket or Windows named pipe.
 * @see architecture.md §IPC Protocol
 */

import { randomUUID } from "node:crypto";
import net from "node:net";
import { platform } from "node:os";

import { NdjsonLineReader } from "@nimbus-dev/sdk/ipc";

const HAS_BUN = (globalThis as { Bun?: unknown }).Bun !== undefined;

type Pending = {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
};

/** Options for {@link IPCClient}. */
export type IPCClientOptions = {
  /**
   * Per-request timeout in milliseconds. A `call()` that receives no matching
   * response within this window rejects with a timeout error, freeing the
   * pending slot. `0` disables the timeout (a wedged gateway then hangs the
   * call forever — the pre-timeout behaviour). Default: 30000.
   */
  requestTimeoutMs?: number;
};

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

export function idKey(id: string | number): string {
  return typeof id === "number" ? `n:${id}` : `s:${id}`;
}

export function jsonRpcErrorMessage(err: unknown): string {
  if (typeof err !== "object" || err === null) {
    return "JSON-RPC error";
  }
  if (!("message" in err)) {
    return "JSON-RPC error";
  }
  const msg = err.message;
  if (typeof msg !== "string") {
    return "JSON-RPC error";
  }
  return msg;
}

export function tryParseJsonRecord(line: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(line) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

export class IPCClient {
  private readonly socketPath: string;
  private reader = new NdjsonLineReader();
  private readonly pending = new Map<string, Pending>();
  private readonly notifHandlers = new Map<string, Set<(params: unknown) => void>>();
  private bunSocket: Awaited<ReturnType<typeof Bun.connect>> | null = null;
  private netSocket: net.Socket | null = null;
  private connected = false;
  private readonly requestTimeoutMs: number;

  constructor(socketPath: string, opts?: IPCClientOptions) {
    this.socketPath = socketPath;
    this.requestTimeoutMs = opts?.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }

  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }
    this.reader = new NdjsonLineReader();

    if (platform() === "win32") {
      await this.connectWindows();
      return;
    }

    await this.connectUnix();
  }

  private async connectWindows(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const sock = net.createConnection(this.socketPath);
      this.attachNetSocket(sock, resolve, reject);
    });
  }

  private attachNetSocket(sock: net.Socket, resolve: () => void, reject: (e: Error) => void): void {
    sock.on("connect", () => {
      this.netSocket = sock;
      this.connected = true;
      resolve();
    });
    sock.on("error", (err) => {
      reject(err);
    });
    sock.on("data", (buf: Buffer) => {
      this.onTransportData(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
    });
    sock.on("close", () => {
      this.onNetSocketClosed();
    });
  }

  private async connectUnix(): Promise<void> {
    if (HAS_BUN) {
      await this.connectUnixBun();
      return;
    }
    await this.connectUnixNode();
  }

  private async connectUnixBun(): Promise<void> {
    this.bunSocket = await Bun.connect({
      unix: this.socketPath,
      socket: {
        data: (_socket, chunk: Uint8Array) => {
          this.onTransportData(chunk);
        },
        close: () => {
          this.onUnixClosed(new Error("IPC connection closed"));
        },
        error: () => {
          this.onUnixClosed(new Error("IPC connection error"));
        },
      },
    });
    this.connected = true;
  }

  private async connectUnixNode(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const sock = net.createConnection({ path: this.socketPath });
      this.attachNetSocket(sock, resolve, reject);
    });
  }

  private onTransportData(chunk: Uint8Array): void {
    try {
      this.ingest(chunk);
    } catch (e) {
      // Framing is corrupt (e.g. an over-long line). Fail every pending call and
      // tear the socket down rather than keep reading a broken stream.
      this.failAll(e);
      this.connected = false;
      this.endWindowsTransport();
      this.endUnixTransport();
    }
  }

  private onNetSocketClosed(): void {
    this.connected = false;
    this.netSocket = null;
    this.failAll(new Error("IPC connection closed"));
  }

  private onUnixClosed(err: Error): void {
    this.connected = false;
    this.bunSocket = null;
    this.failAll(err);
  }

  async call<T>(method: string, params?: unknown): Promise<T> {
    if (!this.connected) {
      throw new Error("IPC client is not connected");
    }
    const id = randomUUID();
    const body: { jsonrpc: string; id: string; method: string; params?: unknown } = {
      jsonrpc: "2.0",
      id,
      method,
    };
    if (params !== undefined) {
      body.params = params;
    }
    const line = `${JSON.stringify(body)}\n`;
    const key = idKey(id);

    return await new Promise<T>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const clear = (): void => {
        if (timer !== undefined) clearTimeout(timer);
      };
      this.pending.set(key, {
        resolve: (v) => {
          clear();
          resolve(v as T);
        },
        reject: (e) => {
          clear();
          reject(e);
        },
      });
      if (this.requestTimeoutMs > 0) {
        timer = setTimeout(() => {
          // Only fire if still pending; the response handler deletes the entry.
          if (this.pending.delete(key)) {
            reject(new Error(`IPC request timed out after ${this.requestTimeoutMs}ms: ${method}`));
          }
        }, this.requestTimeoutMs);
      }
      if (!this.rawWrite(line)) {
        this.pending.delete(key);
        clear();
        reject(new Error(`IPC write failed: transport not connected (${method})`));
      }
    });
  }

  onNotification(method: string, handler: (params: unknown) => void): void {
    let set = this.notifHandlers.get(method);
    if (set === undefined) {
      set = new Set();
      this.notifHandlers.set(method, set);
    }
    set.add(handler);
  }

  /** Remove a handler previously registered with {@link onNotification}. */
  offNotification(method: string, handler: (params: unknown) => void): void {
    const set = this.notifHandlers.get(method);
    if (set === undefined) return;
    set.delete(handler);
    if (set.size === 0) this.notifHandlers.delete(method);
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.failAll(new Error("IPC disconnected"));
    this.endWindowsTransport();
    this.endUnixTransport();
  }

  private endWindowsTransport(): void {
    if (this.netSocket === null) {
      return;
    }
    this.netSocket.end();
    this.netSocket = null;
  }

  private endUnixTransport(): void {
    if (this.bunSocket === null) {
      return;
    }
    this.bunSocket.end();
    this.bunSocket = null;
  }

  /** Write a framed line to the active transport. Returns false if no socket is available. */
  private rawWrite(s: string): boolean {
    if (this.netSocket !== null) {
      this.netSocket.write(s);
      return true;
    }
    if (this.bunSocket !== null) {
      this.bunSocket.write(s);
      return true;
    }
    return false;
  }

  private ingest(chunk: Uint8Array): void {
    const lines = this.reader.push(chunk);
    for (const line of lines) {
      this.dispatchLine(line);
    }
  }

  private dispatchLine(line: string): void {
    const o = tryParseJsonRecord(line);
    if (o === undefined) {
      return;
    }
    if (o["jsonrpc"] !== "2.0") {
      return;
    }
    if (Object.hasOwn(o, "id")) {
      this.dispatchRpcLine(o);
      return;
    }
    this.dispatchNotificationLine(o);
  }

  private dispatchRpcLine(o: Record<string, unknown>): void {
    const id = o["id"];
    if (typeof id !== "string" && typeof id !== "number") {
      return;
    }
    const pend = this.pending.get(idKey(id));
    if (pend === undefined) {
      return;
    }
    this.pending.delete(idKey(id));
    if (Object.hasOwn(o, "error")) {
      pend.reject(new Error(jsonRpcErrorMessage(o["error"])));
      return;
    }
    pend.resolve(Object.hasOwn(o, "result") ? o["result"] : undefined);
  }

  private dispatchNotificationLine(o: Record<string, unknown>): void {
    if (typeof o["method"] !== "string") {
      return;
    }
    const params = Object.hasOwn(o, "params") ? o["params"] : undefined;
    const set = this.notifHandlers.get(o["method"]);
    if (set === undefined) {
      return;
    }
    for (const h of set) {
      h(params);
    }
  }

  private failAll(reason: unknown): void {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    if (this.pending.size === 0) {
      return;
    }
    for (const p of this.pending.values()) {
      p.reject(err);
    }
    this.pending.clear();
  }
}
