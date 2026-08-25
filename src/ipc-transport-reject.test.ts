import { afterEach, describe, expect, it } from "bun:test";

import { closeTestServers, serveNdjson, tempEndpoint } from "../test/_socket-harness.ts";
import { IPCClient, isJsonRpcError } from "./ipc-transport.js";

/**
 * End-to-end over a REAL socket. The unit tests around `JsonRpcError` prove the
 * shape; this proves the wiring — that the transport's reject path actually
 * constructs one. Without it, a regression at the reject site (back to
 * `new Error(...)`) would leave every shape test green.
 */

afterEach(closeTestServers);

/** A Gateway that answers every request with the given JSON-RPC error. */
async function serveError(endpoint: string, error: unknown): Promise<void> {
  await serveNdjson(endpoint, (line, write) => {
    const req = JSON.parse(line) as { id: string | number };
    write(`${JSON.stringify({ jsonrpc: "2.0", id: req.id, error })}\n`);
  });
}

describe("IPCClient rejection carries the JSON-RPC error verbatim", () => {
  it("surfaces code and data from a real response", async () => {
    const endpoint = tempEndpoint("nimbus-rpc-test");
    const readiness = { state: "warming", elapsedMs: 4200, model: "Xenova/all-MiniLM-L6-v2" };
    await serveError(endpoint, {
      code: -32021,
      message: "index.searchRanked: the embedding runtime is still warming up",
      data: { code: "embedding_warming", readiness },
    });

    const client = new IPCClient(endpoint);
    await client.connect();
    try {
      const err = await client.call("index.searchRanked", { name: "x" }).then(
        () => null,
        (e: unknown) => e,
      );

      expect(isJsonRpcError(err)).toBe(true);
      if (!isJsonRpcError(err)) {
        throw new Error("unreachable");
      }
      expect(err.code).toBe(-32021);
      expect(err.data).toEqual({ code: "embedding_warming", readiness });
      // Still an Error, still carrying the message the old transport threw.
      expect(err).toBeInstanceOf(Error);
      expect(err.message).toBe("index.searchRanked: the embedding runtime is still warming up");
    } finally {
      await client.disconnect().catch(() => {});
    }
  });

  it("still rejects usefully when the peer omits code and data", async () => {
    const endpoint = tempEndpoint("nimbus-rpc-test");
    await serveError(endpoint, { message: "plain failure" });

    const client = new IPCClient(endpoint);
    await client.connect();
    try {
      const err = await client.call("whatever", {}).then(
        () => null,
        (e: unknown) => e,
      );
      expect(isJsonRpcError(err)).toBe(true);
      if (!isJsonRpcError(err)) {
        throw new Error("unreachable");
      }
      expect(err.code).toBeNull();
      expect(err.data).toBeUndefined();
      expect(err.message).toBe("plain failure");
    } finally {
      await client.disconnect().catch(() => {});
    }
  });
});
