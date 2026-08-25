import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { createAskStream } from "../src/ask-stream.ts";
import type { StreamEvent } from "../src/stream-events.ts";
import { asIpc, FakeIpc } from "./_fake-ipc.ts";

/**
 * The transport fake is the SHARED one (`./_fake-ipc.ts`), not a private copy.
 * This file used to carry its own `FakeIpc` class plus five hand-rolled inline
 * fakes — six independent transcriptions of `IPCClient`'s surface in one file,
 * which is exactly how a fake stops matching the thing it stands in for. The
 * shared fake already had the three behaviours those copies existed for:
 * `setResponse` (fix one method's answer), `deferMethod` (hold a call in flight
 * and release it later) and `failMethod` (make a call reject).
 */
const DEFAULT_STREAM_ID = "stream-1";

let ipc: FakeIpc;

beforeEach(() => {
  ipc = new FakeIpc();
  ipc.setResponse("engine.askStream", { streamId: DEFAULT_STREAM_ID });
});

// Restore globalThis.fetch if a test mutates it (safety net)
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

async function startAndDrain(
  ipcInstance: FakeIpc,
  opts?: Parameters<typeof createAskStream>[2],
): Promise<{
  handle: ReturnType<typeof createAskStream>;
  events: StreamEvent[];
  drain: Promise<void>;
}> {
  const handle = createAskStream(asIpc(ipcInstance), "hello", opts);
  const events: StreamEvent[] = [];
  const drain = (async () => {
    for await (const ev of handle) events.push(ev);
  })();
  await Promise.resolve();
  await Promise.resolve();
  return { handle, events, drain };
}

/**
 * Start a stream, break out of `for await` after the first event, and let
 * everything settle. Two tests drive exactly this scenario and assert different
 * halves of it — the RPC that goes out, and what the consumer saw.
 */
async function startAndBreakAfterFirstToken(ipcInstance: FakeIpc): Promise<{
  handle: ReturnType<typeof createAskStream>;
  events: StreamEvent[];
}> {
  const handle = createAskStream(asIpc(ipcInstance), "hello");
  const events: StreamEvent[] = [];
  const drain = (async () => {
    for await (const ev of handle) {
      events.push(ev);
      break;
    }
  })();
  await Promise.resolve();
  await Promise.resolve();

  ipcInstance.emit("engine.streamToken", { streamId: DEFAULT_STREAM_ID, text: "first" });
  await drain;
  return { handle, events };
}

describe("askStream", () => {
  test("yields token then done events in order", async () => {
    const { events, drain } = await startAndDrain(ipc);
    ipc.emit("engine.streamToken", { streamId: "stream-1", text: "hi" });
    ipc.emit("engine.streamToken", { streamId: "stream-1", text: " there" });
    ipc.emit("engine.streamDone", {
      streamId: "stream-1",
      meta: { reply: "hi there", sessionId: "sess-1" },
    });
    await drain;
    expect(events.map((e) => e.type)).toEqual(["token", "token", "done"]);
    expect(events[0]).toMatchObject({ type: "token", text: "hi" });
    expect(events[2]).toMatchObject({ type: "done", sessionId: "sess-1" });
  });

  test("ignores notifications for a different streamId", async () => {
    const { events, drain } = await startAndDrain(ipc);
    ipc.emit("engine.streamToken", { streamId: "stream-OTHER", text: "nope" });
    ipc.emit("engine.streamToken", { streamId: "stream-1", text: "yes" });
    ipc.emit("engine.streamDone", { streamId: "stream-1" });
    await drain;
    expect(events).toHaveLength(2);
    expect((events[0] as { text: string }).text).toBe("yes");
  });

  test("error event terminates iterator", async () => {
    const { events, drain } = await startAndDrain(ipc);
    ipc.emit("engine.streamError", {
      streamId: "stream-1",
      code: "boom",
      error: "bad",
    });
    await drain;
    expect(events).toEqual([{ type: "error", code: "boom", message: "bad" }]);
  });

  test("cancel() calls engine.cancelStream and terminates iterator", async () => {
    const { handle, drain } = await startAndDrain(ipc);
    await handle.cancel();
    await drain;
    const cancelCall = ipc.calls.find((c) => c.method === "engine.cancelStream");
    expect(cancelCall).toBeDefined();
    expect(cancelCall?.params).toMatchObject({ streamId: "stream-1" });
  });

  test("subTaskProgress and hitlBatch events flow through", async () => {
    const { events, drain } = await startAndDrain(ipc);
    ipc.emit("agent.subTaskProgress", {
      streamId: "stream-1",
      subTaskId: "st1",
      status: "running",
      progress: 0.5,
    });
    ipc.emit("agent.hitlBatch", {
      streamId: "stream-1",
      requestId: "r1",
      prompt: "Approve?",
    });
    ipc.emit("engine.streamDone", { streamId: "stream-1" });
    await drain;
    expect(events.map((e) => e.type)).toEqual(["subTaskProgress", "hitlBatch", "done"]);
  });

  // ── matchesStream false arms ───────────────────────────────────────────────

  test("ignores token notification when params is null", async () => {
    const { events, drain } = await startAndDrain(ipc);
    ipc.emit("engine.streamToken", null);
    ipc.emit("engine.streamDone", { streamId: "stream-1" });
    await drain;
    // null fails matchesStream, so only the done event lands
    expect(events.map((e) => e.type)).toEqual(["done"]);
  });

  test("ignores token notification when params is a non-object primitive", async () => {
    const { events, drain } = await startAndDrain(ipc);
    ipc.emit("engine.streamToken", "not-an-object");
    ipc.emit("engine.streamDone", { streamId: "stream-1" });
    await drain;
    expect(events.map((e) => e.type)).toEqual(["done"]);
  });

  test("ignores token notification when streamId is missing from params", async () => {
    const { events, drain } = await startAndDrain(ipc);
    // streamId is missing → matchesStream returns false
    ipc.emit("engine.streamToken", { text: "orphan" });
    ipc.emit("engine.streamDone", { streamId: "stream-1" });
    await drain;
    expect(events.map((e) => e.type)).toEqual(["done"]);
  });

  // ── onToken: text not a string ────────────────────────────────────────────

  test("ignores token notification when text is not a string", async () => {
    const { events, drain } = await startAndDrain(ipc);
    ipc.emit("engine.streamToken", { streamId: "stream-1", text: 42 });
    ipc.emit("engine.streamDone", { streamId: "stream-1" });
    await drain;
    // non-string text skips push; only done lands
    expect(events.map((e) => e.type)).toEqual(["done"]);
  });

  // ── onDone: meta absent / reply+sessionId fallback ────────────────────────

  test("done event uses empty-string defaults when meta is absent", async () => {
    const { events, drain } = await startAndDrain(ipc);
    // no meta field → meta ?? {} → reply="" sessionId=""
    ipc.emit("engine.streamDone", { streamId: "stream-1" });
    await drain;
    const done = events.find((e) => e.type === "done") as
      | { type: "done"; reply: string; sessionId: string }
      | undefined;
    expect(done?.reply).toBe("");
    expect(done?.sessionId).toBe("");
  });

  test("done event uses empty-string defaults when reply/sessionId are non-strings", async () => {
    const { events, drain } = await startAndDrain(ipc);
    ipc.emit("engine.streamDone", {
      streamId: "stream-1",
      meta: { reply: 123, sessionId: true },
    });
    await drain;
    const done = events.find((e) => e.type === "done") as
      | { type: "done"; reply: string; sessionId: string }
      | undefined;
    expect(done?.reply).toBe("");
    expect(done?.sessionId).toBe("");
  });

  // ── onError: code/error fallback defaults ─────────────────────────────────

  test("error event uses default code when code is absent", async () => {
    const { events, drain } = await startAndDrain(ipc);
    ipc.emit("engine.streamError", { streamId: "stream-1", error: "oops" });
    await drain;
    const err = events[0] as { type: "error"; code: string; message: string };
    expect(err.code).toBe("stream_error");
    expect(err.message).toBe("oops");
  });

  test("error event uses default message when error field is absent", async () => {
    const { events, drain } = await startAndDrain(ipc);
    ipc.emit("engine.streamError", { streamId: "stream-1", code: "e42" });
    await drain;
    const err = events[0] as { type: "error"; code: string; message: string };
    expect(err.code).toBe("e42");
    expect(err.message).toBe("Stream error");
  });

  test("error event uses both defaults when code and error fields are absent", async () => {
    const { events, drain } = await startAndDrain(ipc);
    ipc.emit("engine.streamError", { streamId: "stream-1" });
    await drain;
    const err = events[0] as { type: "error"; code: string; message: string };
    expect(err.code).toBe("stream_error");
    expect(err.message).toBe("Stream error");
  });

  // ── onSubTask: missing required fields / progress absent ──────────────────

  test("subTaskProgress ignored when subTaskId is missing", async () => {
    const { events, drain } = await startAndDrain(ipc);
    ipc.emit("agent.subTaskProgress", {
      streamId: "stream-1",
      status: "running",
    });
    ipc.emit("engine.streamDone", { streamId: "stream-1" });
    await drain;
    expect(events.map((e) => e.type)).toEqual(["done"]);
  });

  test("subTaskProgress ignored when status is not a string", async () => {
    const { events, drain } = await startAndDrain(ipc);
    ipc.emit("agent.subTaskProgress", {
      streamId: "stream-1",
      subTaskId: "t1",
      status: 99,
    });
    ipc.emit("engine.streamDone", { streamId: "stream-1" });
    await drain;
    expect(events.map((e) => e.type)).toEqual(["done"]);
  });

  test("subTaskProgress without progress field omits optional progress", async () => {
    const { events, drain } = await startAndDrain(ipc);
    ipc.emit("agent.subTaskProgress", {
      streamId: "stream-1",
      subTaskId: "t2",
      status: "pending",
      // no progress field → takes the else branch (no progress property)
    });
    ipc.emit("engine.streamDone", { streamId: "stream-1" });
    await drain;
    const subEv = events[0] as {
      type: "subTaskProgress";
      subTaskId: string;
      status: string;
      progress?: number;
    };
    expect(subEv.type).toBe("subTaskProgress");
    expect(subEv.subTaskId).toBe("t2");
    expect(subEv.status).toBe("pending");
    expect(subEv.progress).toBeUndefined();
  });

  // ── onHitl: missing required fields / details present ────────────────────

  test("hitlBatch ignored when requestId is missing", async () => {
    const { events, drain } = await startAndDrain(ipc);
    ipc.emit("agent.hitlBatch", {
      streamId: "stream-1",
      prompt: "Approve?",
    });
    ipc.emit("engine.streamDone", { streamId: "stream-1" });
    await drain;
    expect(events.map((e) => e.type)).toEqual(["done"]);
  });

  test("hitlBatch ignored when prompt is not a string", async () => {
    const { events, drain } = await startAndDrain(ipc);
    ipc.emit("agent.hitlBatch", {
      streamId: "stream-1",
      requestId: "r1",
      prompt: 42,
    });
    ipc.emit("engine.streamDone", { streamId: "stream-1" });
    await drain;
    expect(events.map((e) => e.type)).toEqual(["done"]);
  });

  test("hitlBatch carries details when present", async () => {
    const { events, drain } = await startAndDrain(ipc);
    ipc.emit("agent.hitlBatch", {
      streamId: "stream-1",
      requestId: "r2",
      prompt: "Deploy?",
      details: { target: "prod" },
    });
    ipc.emit("engine.streamDone", { streamId: "stream-1" });
    await drain;
    const hitl = events[0] as {
      type: "hitlBatch";
      requestId: string;
      prompt: string;
      details?: unknown;
    };
    expect(hitl.type).toBe("hitlBatch");
    expect(hitl.requestId).toBe("r2");
    expect(hitl.details).toEqual({ target: "prod" });
  });

  // ── startPromise: transport/RPC rejection → stream_start_failed ───────────

  test("emits stream_start_failed error when engine.askStream rejects", async () => {
    ipc.failMethod("engine.askStream", "transport down");
    const handle = createAskStream(asIpc(ipc), "hello");
    const events: StreamEvent[] = [];
    for await (const ev of handle) events.push(ev);
    expect(events).toEqual([
      { type: "error", code: "stream_start_failed", message: "transport down" },
    ]);
  });

  // ── early notifications (before streamId resolves) are replayed ───────────

  test("tokens emitted before the streamId resolves are buffered and replayed", async () => {
    const resolveAskStream = ipc.deferMethod("engine.askStream", { streamId: "s-race" });

    const handle = createAskStream(asIpc(ipc), "hello");
    const events: StreamEvent[] = [];
    const drain = (async () => {
      for await (const ev of handle) events.push(ev);
    })();

    // Notifications arrive BEFORE engine.askStream has resolved the streamId.
    ipc.emit("engine.streamToken", { streamId: "s-race", text: "early" });
    ipc.emit("engine.streamDone", { streamId: "s-race" });

    // Now the RPC resolves; the buffered events must replay in order.
    resolveAskStream();
    await drain;

    expect(events.map((e) => e.type)).toEqual(["token", "done"]);
    expect((events[0] as { text: string }).text).toBe("early");
  });

  // ── iterator return() cancels the gateway stream ──────────────────────────

  test("breaking out of for-await sends engine.cancelStream to the gateway", async () => {
    await startAndBreakAfterFirstToken(ipc);

    const cancelCall = ipc.calls.find((c) => c.method === "engine.cancelStream");
    expect(cancelCall).toBeDefined();
    expect(cancelCall?.params).toMatchObject({ streamId: "stream-1" });
  });

  // ── startPromise: no_stream_id error branch ───────────────────────────────

  test("emits error and finishes when gateway returns no streamId", async () => {
    // streamId field absent → typeof sid !== "string"
    ipc.setResponse("engine.askStream", {});
    const handle = createAskStream(asIpc(ipc), "hello");
    const events: StreamEvent[] = [];
    for await (const ev of handle) events.push(ev);
    expect(events).toEqual([
      { type: "error", code: "no_stream_id", message: "Gateway returned no streamId" },
    ]);
  });

  test("emits error and finishes when gateway returns null", async () => {
    ipc.setResponse("engine.askStream", null);
    const handle = createAskStream(asIpc(ipc), "hello");
    const events: StreamEvent[] = [];
    for await (const ev of handle) events.push(ev);
    expect(events).toEqual([
      { type: "error", code: "no_stream_id", message: "Gateway returned no streamId" },
    ]);
  });

  // ── opts.sessionId / opts.agent forwarded in params ───────────────────────

  test("forwards sessionId and agent options to engine.askStream call", async () => {
    const { drain } = await startAndDrain(ipc, { sessionId: "s42", agent: "myAgent" });
    ipc.emit("engine.streamDone", { streamId: "stream-1" });
    await drain;
    const askCall = ipc.calls.find((c) => c.method === "engine.askStream");
    expect(askCall?.params).toMatchObject({ sessionId: "s42", agent: "myAgent" });
  });

  // ── cancel() before streamId resolves ─────────────────────────────────────

  test("cancel() before streamId resolves sets cancelled flag and sends cancelStream after resolve", async () => {
    // Hold engine.askStream in flight until after cancel() has been called.
    const resolveAskStream = ipc.deferMethod("engine.askStream", { streamId: "stream-delayed" });

    const handle = createAskStream(asIpc(ipc), "hello");
    const events: StreamEvent[] = [];
    const drain = (async () => {
      for await (const ev of handle) events.push(ev);
    })();

    // Cancel before askStream resolves (cancelled=true, streamIdResolved=undefined)
    await handle.cancel();

    // Now resolve the askStream call → should trigger the cancelled branch
    resolveAskStream();
    await Promise.resolve();
    await Promise.resolve();
    await drain;

    const cancelCall = ipc.calls.find((c) => c.method === "engine.cancelStream");
    expect(cancelCall).toBeDefined();
    expect(cancelCall?.params).toMatchObject({ streamId: "stream-delayed" });
  });

  // ── cancel() when streamIdResolved is undefined ───────────────────────────

  test("cancel() before start resolves does not call cancelStream with undefined", async () => {
    const resolveAskStream = ipc.deferMethod("engine.askStream", { streamId: "s-late" });

    const handle = createAskStream(asIpc(ipc), "hello");
    // Cancel immediately (streamIdResolved is still undefined)
    await handle.cancel();

    // No cancelStream call should have been made yet (streamId not known)
    const cancelCalls = ipc.calls.filter((c) => c.method === "engine.cancelStream");
    expect(cancelCalls).toHaveLength(0);

    // Resolve the stream so the startPromise doesn't hang
    resolveAskStream();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });

  // ── opts.signal: already aborted ──────────────────────────────────────────

  test("opts.signal already aborted → sends cancelStream immediately", async () => {
    const controller = new AbortController();
    controller.abort();

    const { drain } = await startAndDrain(ipc, { signal: controller.signal });
    await drain;

    const cancelCall = ipc.calls.find((c) => c.method === "engine.cancelStream");
    expect(cancelCall).toBeDefined();
    expect(cancelCall?.params).toMatchObject({ streamId: "stream-1" });
  });

  // ── opts.signal: abort fires after stream starts ───────────────────────────

  test("opts.signal abort event fires → sends cancelStream and terminates iterator", async () => {
    const controller = new AbortController();
    const { events, drain } = await startAndDrain(ipc, { signal: controller.signal });

    ipc.emit("engine.streamToken", { streamId: "stream-1", text: "before" });
    // Abort while stream is running
    controller.abort();
    await Promise.resolve();
    await Promise.resolve();
    await drain;

    // token "before" was already pushed; then finish() was called by the abort handler
    expect(events.some((e) => e.type === "token")).toBe(true);
    const cancelCall = ipc.calls.find((c) => c.method === "engine.cancelStream");
    expect(cancelCall).toBeDefined();
  });

  // ── iterator return() / early break ───────────────────────────────────────

  test("break from for-await calls iterator return() and cleans up", async () => {
    // Breaking after the first token invokes the iterator's return() method.
    const { events } = await startAndBreakAfterFirstToken(ipc);

    expect(events).toHaveLength(1);
    expect((events[0] as { text: string }).text).toBe("first");
  });

  // ── push() after done is a no-op ──────────────────────────────────────────

  test("notifications after stream is done are ignored", async () => {
    const { events, drain } = await startAndDrain(ipc);
    ipc.emit("engine.streamDone", { streamId: "stream-1" });
    await drain;

    // These arrive after done=true — push() should be no-ops
    ipc.emit("engine.streamToken", { streamId: "stream-1", text: "ghost" });
    ipc.emit("engine.streamError", { streamId: "stream-1" });

    await Promise.resolve();
    // events should not grow after done
    expect(events.map((e) => e.type)).toEqual(["done"]);
  });

  // ── finish() idempotence ───────────────────────────────────────────────────

  test("double finish() (cancel + streamError) is safe", async () => {
    const { handle, events, drain } = await startAndDrain(ipc);
    // Finish via error, then cancel — second finish() is a no-op
    ipc.emit("engine.streamError", { streamId: "stream-1", code: "e1", error: "e1msg" });
    await handle.cancel();
    await drain;
    // Only the error event should be present, not duplicated
    expect(events.filter((e) => e.type === "error")).toHaveLength(1);
  });

  // ── iterator next() after done (queue empty, done=true) ───────────────────

  test("calling next() after iterator is done returns done:true immediately", async () => {
    const handle = createAskStream(asIpc(ipc), "hello");
    await Promise.resolve();
    await Promise.resolve();

    const iter = handle[Symbol.asyncIterator]();

    // Terminate the stream by emitting done before pulling
    ipc.emit("engine.streamDone", { streamId: "stream-1" });
    await Promise.resolve();
    await Promise.resolve();

    // Pull all remaining from queue
    let result = await iter.next();
    while (!result.done) {
      result = await iter.next();
    }
    expect(result.done).toBe(true);

    // Call next() again — should return done:true immediately (done=true, queue empty)
    const extra = await iter.next();
    expect(extra.done).toBe(true);
  });

  // ── queue.length > 0 path in next() ───────────────────────────────────────

  test("events queued before iterator polls are drained from queue", async () => {
    // Create the handle but do NOT start iterating yet
    const handle = createAskStream(asIpc(ipc), "hello");
    // Tick to let startPromise resolve and subscribe() register handlers
    await Promise.resolve();
    await Promise.resolve();

    // Emit events before the consumer starts polling
    ipc.emit("engine.streamToken", { streamId: "stream-1", text: "queued1" });
    ipc.emit("engine.streamToken", { streamId: "stream-1", text: "queued2" });
    ipc.emit("engine.streamDone", { streamId: "stream-1" });

    // Now collect — items should come straight from the queue
    const events: StreamEvent[] = [];
    for await (const ev of handle) events.push(ev);

    expect(events.map((e) => e.type)).toEqual(["token", "token", "done"]);
    expect((events[0] as { text: string }).text).toBe("queued1");
  });

  // ── streamId getter ────────────────────────────────────────────────────────

  test("streamId getter returns empty string before resolve and correct id after", async () => {
    const resolveAskStream = ipc.deferMethod("engine.askStream", { streamId: "resolved-id" });

    const handle = createAskStream(asIpc(ipc), "hello");
    // Before resolve, streamId is ""
    expect(handle.streamId).toBe("");

    resolveAskStream();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(handle.streamId).toBe("resolved-id");

    // Cleanup: finish the stream so no pending waiter hangs
    ipc.emit("engine.streamDone", { streamId: "resolved-id" });
    await Promise.resolve();
  });
});

/**
 * The transport documents `onClose` as the escape hatch for a consumer awaiting
 * NOTIFICATIONS: `engine.askStream` resolves immediately with a streamId, so
 * once it has settled there is no pending `call()` left for `failAll` to reject.
 * `createAskStream` never bound it — a gateway dying mid-answer left the
 * consumer's `for await` waiting forever.
 *
 * These tests would HANG (and time out) against the unfixed implementation,
 * which is exactly the failure being fixed.
 */
describe("askStream — unexpected transport close", () => {
  test("emits a transport_closed error and terminates instead of hanging", async () => {
    const { events, drain } = await startAndDrain(ipc);
    ipc.emit("engine.streamToken", { streamId: "stream-1", text: "partial" });

    ipc.emitClose(new Error("socket closed"));

    await drain; // hangs forever without the onClose binding
    expect(events.map((e) => e.type)).toEqual(["token", "error"]);
    expect(events[1]).toMatchObject({ type: "error", code: "transport_closed" });
  });

  test("terminates even when the close arrives before any token", async () => {
    const { events, drain } = await startAndDrain(ipc);
    ipc.emitClose(new Error("gateway died"));
    await drain;
    expect(events).toEqual([{ type: "error", code: "transport_closed", message: "gateway died" }]);
  });

  test("carries the close reason through, so the consumer can report why", async () => {
    const { events, drain } = await startAndDrain(ipc);
    ipc.emitClose(new Error("EPIPE"));
    await drain;
    expect((events[0] as { message: string }).message).toBe("EPIPE");
  });

  /**
   * The removable-handler rule: `finish()` drains `unsubscribers`, which now
   * includes `offClose`. A completed stream must not keep its closure — and the
   * handle behind it — reachable from a live connection.
   */
  test("detaches its close handler once the stream finishes normally", async () => {
    const { events, drain } = await startAndDrain(ipc);
    ipc.emit("engine.streamDone", { streamId: "stream-1" });
    await drain;
    expect(ipc.closeHandlers.size).toBe(0);

    // A later close must not append anything to an already-finished stream.
    ipc.emitClose(new Error("late close"));
    expect(events.map((e) => e.type)).toEqual(["done"]);
  });

  test("detaches its close handler after cancel() too", async () => {
    const { handle, drain } = await startAndDrain(ipc);
    await handle.cancel();
    await drain;
    expect(ipc.closeHandlers.size).toBe(0);
  });

  test("registers exactly one close handler per stream", async () => {
    await startAndDrain(ipc);
    expect(ipc.closeHandlers.size).toBe(1);
  });
});
