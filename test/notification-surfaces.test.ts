import { describe, expect, test } from "bun:test";

import { MockClient } from "../src/mock-client.ts";
import type { ConnectorConfigChanged } from "../src/nimbus-client.ts";
import type { WorkflowRunEvent } from "../src/stream-events.ts";
import { FakeIpc, makeClient } from "./_fake-ipc.ts";

describe("subscribeConnectorConfigChanged", () => {
  test("delivers the gateway's post-mutation snapshot", () => {
    const ipc = new FakeIpc();
    const client = makeClient(ipc);
    const seen: ConnectorConfigChanged[] = [];
    client.subscribeConnectorConfigChanged((ev) => seen.push(ev));

    ipc.emit("connector.configChanged", {
      service: "google_drive",
      intervalMs: 900_000,
      depth: "summary",
      enabled: true,
    });

    expect(seen).toEqual([
      { service: "google_drive", intervalMs: 900_000, depth: "summary", enabled: true },
    ]);
  });

  test("drops a malformed payload instead of throwing into the dispatch loop", () => {
    const ipc = new FakeIpc();
    const client = makeClient(ipc);
    const seen: ConnectorConfigChanged[] = [];
    client.subscribeConnectorConfigChanged((ev) => seen.push(ev));

    // A notification has no caller to reject to — throwing here would take down
    // the transport's dispatch of every OTHER handler on the same message.
    for (const bad of [
      null,
      "nope",
      {},
      { service: "x", intervalMs: "900000", depth: "summary", enabled: true },
      { service: "x", intervalMs: 900_000, depth: "summary", enabled: "yes" },
      { service: 1, intervalMs: 900_000, depth: "summary", enabled: true },
    ]) {
      expect(() => ipc.emit("connector.configChanged", bad)).not.toThrow();
    }
    expect(seen).toEqual([]);
  });

  test("dispose() removes the handler", () => {
    const ipc = new FakeIpc();
    const client = makeClient(ipc);
    const seen: ConnectorConfigChanged[] = [];
    const sub = client.subscribeConnectorConfigChanged((ev) => seen.push(ev));
    const payload = { service: "slack", intervalMs: 1, depth: "full", enabled: false };

    ipc.emit("connector.configChanged", payload);
    sub.dispose();
    ipc.emit("connector.configChanged", payload);

    expect(seen).toHaveLength(1);
    expect(ipc.notifHandlers.get("connector.configChanged")).toHaveLength(0);
  });
});

describe("workflowRunStream", () => {
  const runResult = { runId: "r1", dryRun: false, stepResults: [{ status: "ok" }] };

  test("forces stream:true even though the params type cannot express it", async () => {
    const ipc = new FakeIpc([runResult]);
    const client = makeClient(ipc);
    await client.workflowRunStream({ name: "nightly" }).result;

    expect(ipc.calls[0]?.method).toBe("workflow.run");
    const sent = ipc.calls[0]?.params as { stream?: boolean; name?: string } | undefined;
    expect(sent?.stream).toBe(true);
    expect(sent?.name).toBe("nightly");
  });

  test("subscribes BEFORE the RPC resolves, so same-chunk notifications are not lost", async () => {
    // The response and the first notifications arrive in one socket read and are
    // dispatched line by line; a listener attached after the await would miss them.
    const ipc = new FakeIpc([runResult]);
    const client = makeClient(ipc);
    const handle = client.workflowRunStream({ name: "nightly" });

    expect(ipc.notifHandlers.get("agent.chunk")).toHaveLength(1);
    ipc.emit("agent.chunk", { text: "step 1" });

    const events: WorkflowRunEvent[] = [];
    for await (const ev of handle) events.push(ev);

    expect(events).toEqual([
      { type: "chunk", text: "step 1" },
      { type: "done", result: runResult },
    ]);
  });

  test("detaches the chunk listener once the run settles", async () => {
    const ipc = new FakeIpc([runResult]);
    const client = makeClient(ipc);
    await client.workflowRunStream({ name: "nightly" }).result;

    expect(ipc.notifHandlers.get("agent.chunk")).toHaveLength(0);
  });

  test("a failed run surfaces as a terminal error event and rejects result", async () => {
    const ipc = new FakeIpc([{ runId: 42 }]); // fails validateWorkflowRun
    const client = makeClient(ipc);
    const handle = client.workflowRunStream({ name: "nightly" });

    const events: WorkflowRunEvent[] = [];
    for await (const ev of handle) events.push(ev);

    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("error");
    await expect(handle.result).rejects.toThrow();
    expect(ipc.notifHandlers.get("agent.chunk")).toHaveLength(0);
  });

  test("breaking out of the loop detaches without a cancel RPC (there is none)", async () => {
    const ipc = new FakeIpc([runResult]);
    const client = makeClient(ipc);
    const handle = client.workflowRunStream({ name: "nightly" });
    ipc.emit("agent.chunk", { text: "a" });

    for await (const _ev of handle) break;

    expect(ipc.notifHandlers.get("agent.chunk")).toHaveLength(0);
    expect(ipc.calls.map((c) => c.method)).toEqual(["workflow.run"]);
    await handle.result;
  });

  test("ignores a chunk notification with no string text", async () => {
    const ipc = new FakeIpc([runResult]);
    const client = makeClient(ipc);
    const handle = client.workflowRunStream({ name: "nightly" });
    ipc.emit("agent.chunk", { text: 7 });
    ipc.emit("agent.chunk", null);
    ipc.emit("agent.chunk", { text: "real" });

    const events: WorkflowRunEvent[] = [];
    for await (const ev of handle) events.push(ev);

    expect(events).toEqual([
      { type: "chunk", text: "real" },
      { type: "done", result: runResult },
    ]);
  });
});

describe("MockClient parity", () => {
  test("subscribeConnectorConfigChanged is a disposable no-op", () => {
    const sub = new MockClient().subscribeConnectorConfigChanged(() => {
      throw new Error("mock must not invoke the handler");
    });
    expect(() => sub.dispose()).not.toThrow();
  });

  test("workflowRunStream replays fixture chunks then done", async () => {
    const client = new MockClient({
      workflowRunChunks: ["one ", "two"],
      workflowRun: { runId: "fx", dryRun: true, stepResults: [] },
    });
    const handle = client.workflowRunStream({ name: "nightly" });

    const events: WorkflowRunEvent[] = [];
    for await (const ev of handle) events.push(ev);

    expect(events).toEqual([
      { type: "chunk", text: "one " },
      { type: "chunk", text: "two" },
      { type: "done", result: { runId: "fx", dryRun: true, stepResults: [] } },
    ]);
    await expect(handle.result).resolves.toEqual({
      runId: "fx",
      dryRun: true,
      stepResults: [],
    });
  });

  test("workflowRunStream has a usable default with no fixtures", async () => {
    const handle = new MockClient().workflowRunStream({ name: "nightly" });
    const events: WorkflowRunEvent[] = [];
    for await (const ev of handle) events.push(ev);
    expect(events.filter((e) => e.type === "chunk").length).toBeGreaterThan(0);
    expect(events.at(-1)?.type).toBe("done");
  });
});
