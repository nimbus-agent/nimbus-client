import { afterEach, describe, expect, test } from "bun:test";

import { IPCClient } from "../src/ipc-transport.ts";
import { NimbusClient } from "../src/nimbus-client.ts";
import {
  closeTestServers,
  type RespondToLine,
  serveNdjson,
  tempEndpoint,
} from "./_socket-harness.ts";

// Behavioral end-to-end tests for the dual-runtime transport, over whatever
// endpoint this platform actually uses — a named pipe on Windows, a unix socket
// elsewhere (see _socket-harness.ts). They used to be split into two
// `skipIf`-guarded describes, one per platform, so each CI leg ran half of them;
// the harness lets one pair of tests exercise whichever connect path this
// platform takes, rather than asserting it by reading the source.

afterEach(closeTestServers);

const echoResult =
  (result: unknown): RespondToLine =>
  (line, write) => {
    const req = JSON.parse(line) as { id: string };
    write(`${JSON.stringify({ jsonrpc: "2.0", id: req.id, result })}\n`);
  };

describe("transport end-to-end", () => {
  test("IPCClient round-trips a call", async () => {
    const endpoint = tempEndpoint("nimbus-e2e");
    await serveNdjson(endpoint, (line, write) => {
      const req = JSON.parse(line) as { id: string; method: string };
      write(`${JSON.stringify({ jsonrpc: "2.0", id: req.id, result: { echoed: req.method } })}\n`);
    });

    const c = new IPCClient(endpoint);
    await c.connect();
    expect(await c.call<{ echoed: string }>("ping", { a: 1 })).toEqual({ echoed: "ping" });
    await c.disconnect();
  });

  test("NimbusClient.open dispatches a method", async () => {
    const endpoint = tempEndpoint("nimbus-e2e");
    await serveNdjson(endpoint, echoResult({ head: "h", count: 2 }));

    const client = await NimbusClient.open({ socketPath: endpoint });
    expect(await client.egressHead()).toEqual({ head: "h", count: 2 });
    await client.close();
  });
});

describe("transport connection failure", () => {
  test("NimbusClient.open rejects when the socket/pipe does not exist", async () => {
    // A well-formed endpoint for this platform that nothing is listening on.
    const bogus = tempEndpoint("nimbus-missing");
    await expect(NimbusClient.open({ socketPath: bogus })).rejects.toThrow();
  });
});
