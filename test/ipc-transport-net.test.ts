import { afterEach, describe, expect, test } from "bun:test";
import { once } from "node:events";
import type net from "node:net";

import { IPCClient } from "../src/ipc-transport.ts";
import { closeTestServers, serveAndCapture, serveNdjson, tempEndpoint } from "./_socket-harness.ts";

/**
 * The `node:net` half of the transport, driven on EVERY platform.
 *
 * `connect()` takes one of three dials, fixed for the life of the process by
 * `os.platform()` and by whether a `Bun` global exists: a Windows named pipe through
 * `net.createConnection(path)` (`connectWindows`), a unix socket through `Bun.connect`
 * under Bun (`connectUnixBun`), or a unix socket through
 * `net.createConnection({ path })` under Node (`connectUnixNode`). The two `net` dials
 * share `attachNetSocket` and `onNetSocketClosed`, and between them they are the
 * transport every Windows user and every Node consumer (the CLI's bundle, the VS Code
 * extension) actually runs. Under `bun test` on Linux and macOS, every socket-backed
 * test reaches the gateway through `connect()` and so through the Bun dial, so those CI
 * legs, and the Linux run SonarCloud measures, never executed a line of the `net` half.
 *
 * Node's `net` speaks both a named pipe and a unix socket, so both `net` dials can reach
 * this platform's test endpoint wherever the suite runs. They are called by name because
 * nothing public can select them: under Bun, overriding `process.platform` does not move
 * `os.platform()`, and `HAS_BUN` is read once, when the module loads. Everything after
 * the dial goes through the public surface.
 */

afterEach(closeTestServers);

/** The members these tests reach past the public surface for. */
type NetInternals = {
  connectWindows: () => Promise<void>;
  connectUnixNode: () => Promise<void>;
  netSocket: net.Socket | null;
};

function internals(c: IPCClient): NetInternals {
  return c as unknown as NetInternals;
}

/**
 * `promise`, or a rejection naming `what` once `ms` pass, so an event that never
 * arrives fails with a reason rather than as the runner's anonymous test timeout.
 */
async function within<T>(ms: number, what: string, promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${what} did not happen within ${String(ms)}ms`));
    }, ms);
  });
  try {
    return await Promise.race([promise, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

const NET_DIALS = ["connectWindows", "connectUnixNode"] as const;

for (const dial of NET_DIALS) {
  describe(`IPCClient.${dial} (node:net)`, () => {
    /**
     * Every wait in this file is bounded, the dial and each call included. While
     * proving these tests can fail, a dial whose promise never settled did not fail
     * at the runner's 5 s test timeout: it wedged the whole run past two minutes.
     */
    async function dialed(endpoint: string): Promise<IPCClient> {
      const c = new IPCClient(endpoint, { requestTimeoutMs: 2000 });
      await within(2000, "the dial connecting", internals(c)[dial]());
      return c;
    }

    test("round-trips a call and delivers notifications over the net socket", async () => {
      const endpoint = tempEndpoint("nimbus-net");
      const server = await serveNdjson(endpoint, (line, write) => {
        const req = JSON.parse(line) as { id: string; method: string; params: unknown };
        write(
          `${JSON.stringify({ jsonrpc: "2.0", method: "evt.net", params: { before: req.method } })}\n`,
        );
        write(
          `${JSON.stringify({ jsonrpc: "2.0", id: req.id, result: { echoed: req.params } })}\n`,
        );
      });
      const c = await dialed(endpoint);
      const seen: unknown[] = [];
      c.onNotification("evt.net", (p) => seen.push(p));

      expect(await c.call<{ echoed: unknown }>("ping", { n: 1 })).toEqual({ echoed: { n: 1 } });
      // The notification precedes the response on the stream, so it has been
      // dispatched by the time the call's continuation runs.
      expect(seen).toEqual([{ before: "ping" }]);
      expect(server.accepted()).toBe(1);
      await c.disconnect();
    });

    test("a gateway dying under a pending call rejects it, notifies onClose once, and disconnects", async () => {
      const endpoint = tempEndpoint("nimbus-net");
      const { socket } = await serveAndCapture(endpoint);
      const c = await dialed(endpoint);
      const closes: string[] = [];
      c.onClose((err) => closes.push(err.message));

      const pending = c.call("never.answered");
      (await socket).destroy();

      await expect(pending).rejects.toThrow(/^IPC connection closed$/);
      expect(closes).toEqual(["IPC connection closed"]);
      // The client knows it has no transport any more: a later call is refused up
      // front instead of being written to a dead socket.
      await expect(c.call("after.death")).rejects.toThrow(/^IPC client is not connected$/);
      expect(internals(c).netSocket).toBeNull();
    });

    test("a dial nothing answers rejects with the socket error and stays unconnected", async () => {
      const c = new IPCClient(tempEndpoint("nimbus-net-missing"));
      const settled = internals(c)
        [dial]()
        .then(
          () => null,
          (e: unknown) => e,
        );
      const err = await within(2000, "the failed dial settling", settled);
      // ENOENT on every platform: a unix socket path that does not exist and a pipe
      // name nothing has created fail the same way.
      expect((err as NodeJS.ErrnoException | null)?.code).toBe("ENOENT");
      await expect(c.call("x")).rejects.toThrow(/^IPC client is not connected$/);
    });

    test("an over-long frame fails the pending call and ends the net socket", async () => {
      const endpoint = tempEndpoint("nimbus-net");
      const { socket } = await serveAndCapture(endpoint);
      const c = await dialed(endpoint);
      const pending = c.call("oversized");

      const gatewaySide = await socket;
      const ended = once(gatewaySide, "end");
      // One byte past the reader's 1 MB line limit, and no newline to end the frame.
      gatewaySide.write("x".repeat(1024 * 1024 + 1));

      await expect(pending).rejects.toThrow(/^Message exceeds 1MB line limit$/);
      // The client ended the connection instead of reading on from a broken stream.
      await within(2000, "the gateway seeing the client end the connection", ended);
      await expect(c.call("after.teardown")).rejects.toThrow(/^IPC client is not connected$/);
    });

    test("disconnect() ends the net socket without firing onClose", async () => {
      const endpoint = tempEndpoint("nimbus-net");
      const { socket } = await serveAndCapture(endpoint);
      const c = await dialed(endpoint);
      let fired = 0;
      c.onClose(() => {
        fired += 1;
      });
      const clientSide = internals(c).netSocket;
      if (clientSide === null) throw new Error("the dial resolved without a net socket");
      const clientClosed = once(clientSide, "close");
      const gatewaySawEnd = once(await socket, "end");

      await c.disconnect();
      await within(2000, "the gateway seeing the client end the connection", gatewaySawEnd);
      // The client socket's own `close` is the event that routes into
      // onNetSocketClosed, so asserting before it has fired would prove nothing.
      await within(2000, "the client socket closing", clientClosed);
      expect(fired).toBe(0);
      expect(internals(c).netSocket).toBeNull();
    });
  });
}
