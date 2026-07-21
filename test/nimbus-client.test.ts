import { describe, expect, test } from "bun:test";

import { NimbusClient } from "../src/nimbus-client.ts";
import type { HitlRequest } from "../src/stream-events.ts";
import { IpcResponseError } from "../src/validate.ts";

type CallSpy = { method: string; params: unknown };

class FakeIpc {
  public calls: CallSpy[] = [];
  public notifHandlers = new Map<string, ((p: unknown) => void)[]>();
  private readonly responses: unknown[];
  constructor(responses: unknown[] = []) {
    this.responses = responses;
  }
  async call(method: string, params: unknown): Promise<unknown> {
    this.calls.push({ method, params });
    return this.responses.shift() ?? { ok: true };
  }
  onNotification(method: string, handler: (p: unknown) => void): void {
    const arr = this.notifHandlers.get(method) ?? [];
    arr.push(handler);
    this.notifHandlers.set(method, arr);
  }
  offNotification(method: string, handler: (p: unknown) => void): void {
    const arr = this.notifHandlers.get(method);
    if (arr === undefined) return;
    const i = arr.indexOf(handler);
    if (i >= 0) arr.splice(i, 1);
  }
  emit(method: string, params: unknown): void {
    for (const h of this.notifHandlers.get(method) ?? []) h(params);
  }
  async disconnect(): Promise<void> {
    /* no-op fake */
  }
}

function makeClient(ipc: FakeIpc): NimbusClient {
  return new (NimbusClient as unknown as new (ipc: unknown) => NimbusClient)(ipc);
}

describe("NimbusClient method dispatch", () => {
  test("agentInvoke sends defaults and omits undefined optionals", async () => {
    const ipc = new FakeIpc([{ reply: "ok" }]);
    await makeClient(ipc).agentInvoke("hello");
    expect(ipc.calls[0]).toEqual({
      method: "agent.invoke",
      params: { input: "hello", stream: false },
    });
  });

  test("agentInvoke includes sessionId + agent when provided", async () => {
    const ipc = new FakeIpc([{}]);
    await makeClient(ipc).agentInvoke("hi", { stream: true, sessionId: "s1", agent: "a1" });
    expect(ipc.calls[0]?.params).toEqual({
      input: "hi",
      stream: true,
      sessionId: "s1",
      agent: "a1",
    });
  });

  test("getSessionTranscript / cancelStream / querySql / auditList route correctly", async () => {
    const ipc = new FakeIpc([
      { sessionId: "s", turns: [], hasMore: false },
      { ok: true },
      { rows: [] },
      [],
    ]);
    const c = makeClient(ipc);
    await c.getSessionTranscript({ sessionId: "s" });
    await c.cancelStream("stream-9");
    await c.querySql("SELECT 1");
    await c.auditList();
    expect(ipc.calls.map((x) => x.method)).toEqual([
      "engine.getSessionTranscript",
      "engine.cancelStream",
      "index.querySql",
      "audit.list",
    ]);
    expect(ipc.calls[1]?.params).toEqual({ streamId: "stream-9" });
    expect(ipc.calls[3]?.params).toEqual({ limit: 50 });
  });

  test("auditList passes a custom limit", async () => {
    const ipc = new FakeIpc([[]]);
    await makeClient(ipc).auditList(7);
    expect(ipc.calls[0]?.params).toEqual({ limit: 7 });
  });

  test("queryItems forwards all filter params", async () => {
    const ipc = new FakeIpc([{ items: [], meta: { limit: 0, total: 0 } }]);
    await makeClient(ipc).queryItems({ services: ["github"], types: ["pr"], limit: 5 });
    expect(ipc.calls[0]).toMatchObject({ method: "index.queryItems" });
    const params = ipc.calls[0]?.params as Record<string, unknown>;
    expect(params["services"]).toEqual(["github"]);
  });

  test("searchRanked routes to index.searchRanked and returns the rows", async () => {
    // A RankedSearchItem is a NimbusItem plus ranking fields, so the base item
    // fields are required. They were absent while tests went untypechecked;
    // validateRankedItems casts, so only the compiler could have caught it.
    const row = {
      id: "x",
      service: "drive",
      itemType: "file",
      name: "x",
      score: 1,
      indexPrimaryKey: "pk-x",
      indexedType: "file",
    };
    const ipc = new FakeIpc([[row]]);
    const out = await makeClient(ipc).searchRanked({
      name: "plan",
      service: "drive",
      itemType: "file",
      limit: 5,
      semantic: false,
      contextChunks: 1,
    });
    expect(ipc.calls[0]?.method).toBe("index.searchRanked");
    expect(ipc.calls[0]?.params).toMatchObject({
      name: "plan",
      service: "drive",
      itemType: "file",
      limit: 5,
      semantic: false,
      contextChunks: 1,
    });
    expect(out).toEqual([row]);
  });

  test("searchRanked tolerates being called with no params", async () => {
    const ipc = new FakeIpc([[]]);
    const out = await makeClient(ipc).searchRanked();
    expect(ipc.calls[0]?.method).toBe("index.searchRanked");
    expect(out).toEqual([]);
  });

  test("egress read methods route to the right JSON-RPC methods", async () => {
    const ipc = new FakeIpc([
      { head: "abc", count: 3 },
      { rows: [] },
      { ok: true, verifiedRows: 3 },
      {
        rows: [],
        completeness: { tier: "authorized-actions", outboundEgressEvents: 0 },
        verify: { ok: true, verifiedRows: 3 },
      },
    ]);
    const c = makeClient(ipc);
    const head = await c.egressHead();
    await c.egressList();
    await c.egressVerify();
    await c.egressProveWindow();
    expect(ipc.calls.map((x) => x.method)).toEqual([
      "egress.head",
      "egress.list",
      "egress.verify",
      "egress.proveWindow",
    ]);
    expect(head).toEqual({ head: "abc", count: 3 });
  });

  test("egressList forwards window + limit params", async () => {
    const ipc = new FakeIpc([{ rows: [] }]);
    await makeClient(ipc).egressList({ since: 10, until: 20, limit: 5 });
    expect(ipc.calls[0]?.method).toBe("egress.list");
    expect(ipc.calls[0]?.params).toEqual({ since: 10, until: 20, limit: 5 });
  });

  test("egressProveWindow forwards since/until/sign", async () => {
    const ipc = new FakeIpc([
      {
        rows: [],
        completeness: { tier: "authorized-actions", outboundEgressEvents: 0 },
        verify: { ok: true, verifiedRows: 0 },
      },
    ]);
    await makeClient(ipc).egressProveWindow({ since: 1, until: 2, sign: true });
    expect(ipc.calls[0]?.method).toBe("egress.proveWindow");
    expect(ipc.calls[0]?.params).toEqual({ since: 1, until: 2, sign: true });
  });

  test("askStream returns a handle with a string streamId", async () => {
    const ipc = new FakeIpc([{ streamId: "stream-1" }]);
    const h = makeClient(ipc).askStream("hi");
    expect(typeof h.streamId).toBe("string");
  });

  test("subscribeHitl forwards valid batches and filters malformed ones", () => {
    const ipc = new FakeIpc();
    const got: HitlRequest[] = [];
    makeClient(ipc).subscribeHitl((r) => got.push(r));
    ipc.emit("agent.hitlBatch", { requestId: "r1", prompt: "Approve?", streamId: "s1" });
    ipc.emit("agent.hitlBatch", { requestId: "r2", prompt: "No stream" });
    ipc.emit("agent.hitlBatch", { prompt: "no requestId" });
    ipc.emit("agent.hitlBatch", null);
    expect(got).toHaveLength(2);
    expect(got[0]).toMatchObject({ requestId: "r1", prompt: "Approve?", streamId: "s1" });
    expect(got[1]).toMatchObject({ requestId: "r2", prompt: "No stream" });
    expect(got[1]).not.toHaveProperty("streamId");
  });

  test("close disconnects the transport", async () => {
    const ipc = new FakeIpc();
    let disconnected = false;
    ipc.disconnect = async () => {
      disconnected = true;
    };
    await makeClient(ipc).close();
    expect(disconnected).toBe(true);
  });
});

describe("queryItems result validation", () => {
  test("returns the gateway's camelCase item verbatim", async () => {
    const ipc = new FakeIpc([
      {
        items: [
          {
            id: "run-1",
            indexPrimaryKey: "github:run-1",
            service: "github",
            itemType: "ci_run",
            name: "nightly build",
            modifiedAt: 1_700_000_000_000,
            createdAt: 1_600_000_000_000,
            url: "https://example.test/r/1",
            mimeType: "application/json",
            sizeBytes: 12,
            parentId: "github:wf-9",
          },
        ],
        meta: { limit: 50, total: 1 },
      },
    ]);

    const { items, meta } = await makeClient(ipc).queryItems({ limit: 50 });

    expect(items[0]).toEqual({
      id: "run-1",
      indexPrimaryKey: "github:run-1",
      service: "github",
      itemType: "ci_run",
      name: "nightly build",
      mimeType: "application/json",
      sizeBytes: 12,
      createdAt: 1_600_000_000_000,
      modifiedAt: 1_700_000_000_000,
      url: "https://example.test/r/1",
      parentId: "github:wf-9",
    });
    expect(meta).toEqual({ limit: 50, total: 1 });
  });

  test("omits optional fields the item does not carry", async () => {
    const ipc = new FakeIpc([
      {
        items: [{ id: "x1", indexPrimaryKey: "x:x1", service: "x", itemType: "file", name: "n" }],
        meta: { limit: 1, total: 1 },
      },
    ]);
    const { items } = await makeClient(ipc).queryItems({});
    expect(items[0]).toEqual({
      id: "x1",
      indexPrimaryKey: "x:x1",
      service: "x",
      itemType: "file",
      name: "n",
    });
  });

  test("preserves an item type this client version does not know", async () => {
    const ipc = new FakeIpc([
      {
        items: [
          { id: "x1", indexPrimaryKey: "x:x1", service: "x", itemType: "dora_metric", name: "n" },
        ],
        meta: { limit: 1, total: 1 },
      },
    ]);
    const { items } = await makeClient(ipc).queryItems({});
    expect(items[0]?.itemType).toBe("dora_metric");
  });

  test("throws IpcResponseError when items is not an array", async () => {
    const ipc = new FakeIpc([{ items: "nope", meta: { limit: 0, total: 0 } }]);
    await expect(makeClient(ipc).queryItems({})).rejects.toBeInstanceOf(IpcResponseError);
  });

  test("throws IpcResponseError when indexPrimaryKey is missing", async () => {
    const ipc = new FakeIpc([
      {
        items: [{ id: "x1", service: "x", itemType: "file", name: "n" }],
        meta: { limit: 1, total: 1 },
      },
    ]);
    await expect(makeClient(ipc).queryItems({})).rejects.toBeInstanceOf(IpcResponseError);
  });

  test("throws IpcResponseError on a snake_case row from an old gateway", async () => {
    // Version skew: client 0.6.0 against a pre-Task-2 gateway. Failing loudly
    // is intended — the alternative is silently undefined fields.
    const ipc = new FakeIpc([
      {
        items: [{ id: "github:run-1", service: "github", type: "ci_run", title: "nightly" }],
        meta: { limit: 1, total: 1 },
      },
    ]);
    await expect(makeClient(ipc).queryItems({})).rejects.toBeInstanceOf(IpcResponseError);
  });
});
