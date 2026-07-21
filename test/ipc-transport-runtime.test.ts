import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { IPCClient } from "../src/ipc-transport.ts";
import { NimbusClient } from "../src/nimbus-client.ts";

// Behavioral end-to-end tests for the dual-runtime transport. The Unix leg runs
// on POSIX (via Bun.listen), the named-pipe leg runs on Windows (via net) — so
// the platform-specific connect path is actually exercised on each platform,
// rather than asserted by reading the source.

const isWin = process.platform === "win32";

type Respond = (line: string, write: (s: string) => void) => void;

function uniquePipe(): string {
  return String.raw`\\.\pipe\nimbus-test-${process.pid}-${Date.now()}-${Math.floor(
    Math.random() * 1e6,
  )}`;
}

// A minimal NDJSON JSON-RPC server over a Node socket (named pipe on Windows,
// Unix socket on POSIX under Node).
function startNetServer(path: string, respond: Respond): net.Server {
  const server = net.createServer((sock) => {
    let buf = "";
    sock.on("data", (d: Buffer) => {
      buf += d.toString("utf8");
      let idx = buf.indexOf("\n");
      while (idx >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        if (line.trim().length > 0) respond(line, (s) => sock.write(s));
        idx = buf.indexOf("\n");
      }
    });
  });
  server.listen(path);
  return server;
}

function startBunServer(path: string, respond: Respond): { stop: () => void } {
  const server = Bun.listen({
    unix: path,
    socket: {
      data(sock, chunk) {
        const write = (s: string): void => {
          (sock as unknown as { write: (s: string) => void }).write(s);
        };
        for (const line of new TextDecoder().decode(chunk).split("\n")) {
          if (line.trim().length > 0) respond(line, write);
        }
      },
    },
  });
  return { stop: () => server.stop(true) };
}

const echoResult =
  (result: unknown): Respond =>
  (line, write) => {
    const req = JSON.parse(line) as { id: string };
    write(`${JSON.stringify({ jsonrpc: "2.0", id: req.id, result })}\n`);
  };

describe("transport end-to-end (named pipe / Windows)", () => {
  test.skipIf(!isWin)("IPCClient round-trips a call over a named pipe", async () => {
    const path = uniquePipe();
    const server = startNetServer(path, (line, write) => {
      const req = JSON.parse(line) as { id: string; method: string };
      write(`${JSON.stringify({ jsonrpc: "2.0", id: req.id, result: { echoed: req.method } })}\n`);
    });
    try {
      const c = new IPCClient(path);
      await c.connect();
      expect(await c.call<{ echoed: string }>("ping", { a: 1 })).toEqual({ echoed: "ping" });
      await c.disconnect();
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  test.skipIf(!isWin)("NimbusClient.open dispatches a method over a named pipe", async () => {
    const path = uniquePipe();
    const server = startNetServer(path, echoResult({ head: "h", count: 2 }));
    try {
      const client = await NimbusClient.open({ socketPath: path });
      expect(await client.egressHead()).toEqual({ head: "h", count: 2 });
      await client.close();
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});

describe("transport end-to-end (unix socket / POSIX)", () => {
  test.skipIf(isWin)("NimbusClient.open dispatches a method over a unix socket", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "nimbus-e2e-"));
    const path = join(tmp, "gw.sock");
    const server = startBunServer(path, echoResult({ head: "h", count: 2 }));
    try {
      const client = await NimbusClient.open({ socketPath: path });
      expect(await client.egressHead()).toEqual({ head: "h", count: 2 });
      await client.close();
    } finally {
      server.stop();
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("transport connection failure", () => {
  test("NimbusClient.open rejects when the socket/pipe does not exist", async () => {
    const bogus = isWin ? uniquePipe() : join(tmpdir(), `nimbus-missing-${Date.now()}.sock`);
    await expect(NimbusClient.open({ socketPath: bogus })).rejects.toThrow();
  });
});
