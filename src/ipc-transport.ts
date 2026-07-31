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

/**
 * Marks a `JsonRpcError` structurally rather than by prototype.
 *
 * `instanceof` is not reliable here: a consumer can end up with two copies of
 * this package in its dependency graph (npm/bun hoisting, or a workspace link
 * beside a published copy), and an error constructed by one copy fails
 * `instanceof` against the other's class. The brand travels with the value.
 */
const JSON_RPC_ERROR_BRAND = "nimbus-dev/client:json-rpc-error";

/**
 * A JSON-RPC error response, surfaced with its `code` and `data` intact.
 *
 * Before this existed the transport rejected with a bare `new Error(message)`,
 * so a caller got the human-readable text and nothing else. Every typed error
 * the Gateway defines — `-32021` "the embedding runtime is still warming", and
 * any future `-32xxx` — arrived indistinguishable from a generic failure,
 * leaving consumers to either match on message text or give up. `nimbus search`
 * ended up issuing a second `gateway.ping` purely to recover state the first
 * response had already carried and thrown away.
 *
 * `message` is byte-identical to what the transport threw before, so callers
 * that only read (or match on) `.message` are unaffected.
 */
export class JsonRpcError extends Error {
  /** @see JSON_RPC_ERROR_BRAND */
  readonly nimbusErrorBrand: string = JSON_RPC_ERROR_BRAND;

  /** JSON-RPC `error.code`; `null` when the peer omitted it or sent a non-number. */
  readonly code: number | null;

  /** JSON-RPC `error.data`, verbatim. `undefined` when absent. */
  readonly data: unknown;

  constructor(message: string, code: number | null, data: unknown) {
    super(message);
    this.name = "JsonRpcError";
    this.code = code;
    this.data = data;
  }
}

/** True for a `JsonRpcError` from ANY copy of this package (brand check, not `instanceof`). */
export function isJsonRpcError(err: unknown): err is JsonRpcError {
  if (err instanceof JsonRpcError) {
    return true;
  }
  if (typeof err !== "object" || err === null) {
    return false;
  }
  return (err as { nimbusErrorBrand?: unknown }).nimbusErrorBrand === JSON_RPC_ERROR_BRAND;
}

/** Reads `error.code` off a raw JSON-RPC error object. `null` unless it is a number. */
export function jsonRpcErrorCode(err: unknown): number | null {
  if (typeof err !== "object" || err === null || !("code" in err)) {
    return null;
  }
  const code = (err as { code: unknown }).code;
  return typeof code === "number" ? code : null;
}

/** Reads `error.data` off a raw JSON-RPC error object. `undefined` when absent. */
export function jsonRpcErrorData(err: unknown): unknown {
  if (typeof err !== "object" || err === null || !("data" in err)) {
    return undefined;
  }
  return (err as { data: unknown }).data;
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
  private readonly closeHandlers = new Set<(err: Error) => void>();
  private closeNotified = false;
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
    // A fresh connection gets a fresh close notification; the once-guard below
    // is per-connection, not per-instance.
    this.closeNotified = false;

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
    const err = new Error("IPC connection closed");
    this.failAll(err);
    this.notifyClosed(err);
  }

  private onUnixClosed(err: Error): void {
    this.connected = false;
    this.bunSocket = null;
    this.failAll(err);
    this.notifyClosed(err);
  }

  /**
   * Fire the {@link onClose} handlers, at most once per connection.
   *
   * The once-guard is load-bearing on the Bun path: `Bun.connect`'s `error` and
   * `close` callbacks BOTH route here, so a socket that errors and then closes
   * would otherwise notify twice.
   *
   * Runs AFTER `failAll`, so a handler observes a settled client: every pending
   * promise is rejected and the map is cleared. Their `.catch()` continuations
   * are microtasks and generally run after this returns — internal state is
   * settled, observable consumer callbacks are not yet.
   *
   * A throwing handler is swallowed: these run from a socket event, where an
   * escaping throw becomes an unhandled exception rather than reaching any
   * caller, and one bad handler must not suppress its siblings. Iterating a
   * copy keeps a handler that calls `offClose` on itself from mutating the set
   * mid-loop.
   */
  private notifyClosed(err: Error): void {
    if (this.closeNotified) {
      return;
    }
    this.closeNotified = true;
    for (const handler of [...this.closeHandlers]) {
      try {
        handler(err);
      } catch {
        /* a handler's failure is its own problem, not the transport's */
      }
    }
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

  /**
   * Register a handler for an UNEXPECTED transport close.
   *
   * `call()` bounds itself with `requestTimeoutMs`, so a silent gateway cannot
   * hang a request. A caller awaiting a NOTIFICATION has no such bound: for a
   * long-running job the request that starts the work resolves immediately with
   * a job id, and the result arrives later as a notification. If the gateway
   * dies in between, nothing further ever arrives and the wait hangs forever —
   * there is no pending `call()` left for `failAll` to reject. `onClose` is the
   * escape hatch for exactly that shape.
   *
   * Deliberately does NOT fire on {@link disconnect} — a consumer that closed
   * the connection itself already knows. Firing there would invoke close
   * handlers on every ordinary teardown, including the successful path where
   * the consumer's promise has already settled.
   *
   * Fires at most once per connection, after `failAll` has rejected every
   * pending call. Note that "rejected" means the promises are settled and the
   * pending map is cleared — a consumer's own `.catch()` continuation is a
   * microtask and will typically run AFTER the close handler, so do not rely on
   * seeing call rejections first from outside.
   *
   * Pair with {@link offClose} on teardown, per this repo's removable-handler
   * rule — a leaked handler keeps a dead consumer reachable.
   */
  onClose(handler: (err: Error) => void): void {
    this.closeHandlers.add(handler);
  }

  /** Remove a handler previously registered with {@link onClose}. */
  offClose(handler: (err: Error) => void): void {
    this.closeHandlers.delete(handler);
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    // Consume the close notification BEFORE tearing the socket down. The
    // teardown below raises the transport's own close event, which routes into
    // `notifyClosed` exactly as an unexpected death would — so without this the
    // "does not fire on disconnect" rule would be silently false, and every
    // ordinary teardown would invoke close handlers.
    this.closeNotified = true;
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
      const raw = o["error"];
      pend.reject(
        new JsonRpcError(jsonRpcErrorMessage(raw), jsonRpcErrorCode(raw), jsonRpcErrorData(raw)),
      );
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
