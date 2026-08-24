import net from "node:net";
import os from "node:os";
import path from "node:path";

/**
 * Shared socket/pipe harness for the transport tests.
 *
 * Three test files were each carrying their own copy of "mint a unique endpoint,
 * stand up an NDJSON gateway on it, tear it down afterwards". The copies had
 * drifted: two used `net` (and so ran on every platform), one used
 * `Bun.listen({ unix })` — which cannot open a Windows named pipe, so its whole
 * socket-backed suite was `skipIf(isWin)` and the Windows CI leg never executed
 * a single one of those assertions.
 *
 * `net` is the common denominator: it speaks both a Windows named pipe and a
 * POSIX unix socket, and `IPCClient` connects to either (named pipe via `net`,
 * unix socket via `Bun.connect`). One harness, every platform, no skips.
 */

/** A gateway's reply hook: one complete NDJSON line in, framed writes back out. */
export type RespondToLine = (line: string, write: (s: string) => void) => void;

export type TestServer = {
  readonly endpoint: string;
  /**
   * Force-close. Live connections are DESTROYED first, not merely refused: the
   * tests that matter here are the ones where the gateway dies underneath an
   * in-flight call, and a plain `server.close()` only stops accepting new
   * connections. Idempotent.
   */
  stop: () => Promise<void>;
};

/**
 * An endpoint this platform's `IPCClient` can actually connect to, unique per
 * call: a Windows named pipe, or a `.sock` under `tmpdir()` everywhere else.
 */
export function tempEndpoint(prefix: string): string {
  const id = `${prefix}-${String(process.pid)}-${String(Date.now())}-${String(
    Math.floor(Math.random() * 1e6),
  )}`;
  // No path.join() on the win32 arm, deliberately: a named pipe name lives in the
  // literal `\\.\pipe\` namespace, not on the filesystem, so joining it is wrong by
  // construction. The POSIX arm is a real path and does use path.join().
  return process.platform === "win32"
    ? `${String.raw`\\.\pipe`}\\${id}`
    : path.join(os.tmpdir(), `${id}.sock`);
}

const live = new Set<TestServer>();

async function listen(server: net.Server, endpoint: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    // Without this, a failed listen (a stale socket file, a pipe name already
    // taken) is an unhandled `error` event, which takes the whole test process
    // down with a stack that never names the endpoint.
    const onListenError = (err: Error): void => {
      reject(new Error(`test server could not listen on ${endpoint}: ${err.message}`));
    };
    server.once("error", onListenError);
    server.listen(endpoint, () => {
      server.off("error", onListenError);
      // Past listen, a server-level error must not become an unhandled event
      // either: `stop()` destroys live connections, and that can surface here.
      server.on("error", () => {
        /* teardown noise */
      });
      resolve();
    });
  });
}

function register(server: net.Server, endpoint: string, sockets: Set<net.Socket>): TestServer {
  let stopped = false;
  const handle: TestServer = {
    endpoint,
    stop: async () => {
      if (stopped) return;
      stopped = true;
      live.delete(handle);
      for (const sock of sockets) sock.destroy();
      sockets.clear();
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      });
    },
  };
  live.add(handle);
  return handle;
}

/**
 * Track an accepted connection so `stop()` can destroy it, and swallow its
 * errors: destroying a socket raises ECONNRESET on the other end, and an
 * unhandled `error` event on a `net.Socket` takes the whole test process down.
 */
function adopt(sockets: Set<net.Socket>, sock: net.Socket): void {
  sockets.add(sock);
  sock.on("error", () => {
    /* a killed connection is the point of these tests, not a failure */
  });
  sock.on("close", () => {
    sockets.delete(sock);
  });
}

/** A gateway that answers NDJSON requests: `respond` runs once per complete line. */
export async function serveNdjson(endpoint: string, respond: RespondToLine): Promise<TestServer> {
  const sockets = new Set<net.Socket>();
  const server = net.createServer((sock) => {
    adopt(sockets, sock);
    let buf = "";
    const write = (s: string): void => {
      sock.write(s);
    };
    sock.on("data", (d: Buffer) => {
      buf += d.toString("utf8");
      let idx = buf.indexOf("\n");
      while (idx >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        if (line.trim().length > 0) respond(line, write);
        idx = buf.indexOf("\n");
      }
    });
  });
  await listen(server, endpoint);
  return register(server, endpoint, sockets);
}

/**
 * A gateway that accepts a connection and hands the raw socket back, for tests
 * that need to kill the connection from the server side at a chosen moment.
 */
export async function serveAndCapture(
  endpoint: string,
): Promise<{ server: TestServer; socket: Promise<net.Socket> }> {
  const sockets = new Set<net.Socket>();
  let handOver: (s: net.Socket) => void = () => undefined;
  const socket = new Promise<net.Socket>((resolve) => {
    handOver = resolve;
  });
  const server = net.createServer((sock) => {
    adopt(sockets, sock);
    handOver(sock);
  });
  await listen(server, endpoint);
  return { server: register(server, endpoint, sockets), socket };
}

/** `afterEach` teardown: closes every server this module is still holding open. */
export async function closeTestServers(): Promise<void> {
  await Promise.all([...live].map((s) => s.stop()));
}
