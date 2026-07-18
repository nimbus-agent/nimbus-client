import type { IPCClient } from "./ipc-transport.js";
import type { AskStreamHandle, AskStreamOptions, StreamEvent } from "./stream-events.js";

type Pending = { resolve: (v: IteratorResult<StreamEvent>) => void; reject: (e: Error) => void };

export function createAskStream(
  ipc: IPCClient,
  input: string,
  opts: AskStreamOptions = {},
): AskStreamHandle {
  const queue: StreamEvent[] = [];
  const waiters: Pending[] = [];
  let done = false;
  let streamIdResolved: string | undefined;
  let cancelled = false;
  let unsubscribers: Array<() => void> = [];
  // Notifications that arrive before engine.askStream resolves the streamId are
  // buffered here and replayed once the id is known (see the subscribe-before-send
  // note below), so tokens pipelined in the same socket chunk as the RPC response
  // are not lost.
  let early: Array<() => void> = [];

  const push = (ev: StreamEvent): void => {
    if (done) return;
    if (waiters.length > 0) {
      const w = waiters.shift() as Pending;
      w.resolve({ value: ev, done: false });
      return;
    }
    queue.push(ev);
  };

  const finish = (): void => {
    if (done) return;
    done = true;
    early = [];
    for (const u of unsubscribers) u();
    unsubscribers = [];
    while (waiters.length > 0) {
      const w = waiters.shift() as Pending;
      w.resolve({ value: undefined, done: true });
    }
  };

  const cancelUpstream = async (sid: string): Promise<void> => {
    await ipc.call("engine.cancelStream", { streamId: sid }).catch(() => undefined);
  };

  const matchesStream = (params: unknown): params is { streamId: string } => {
    return (
      typeof params === "object" &&
      params !== null &&
      typeof (params as { streamId?: unknown }).streamId === "string"
    );
  };

  // Wrap a typed handler so it (a) buffers events that arrive before the streamId
  // is known and (b) only fires for events tagged with *our* streamId.
  const whenMatched =
    (handler: (params: { streamId: string }) => void) =>
    (params: unknown): void => {
      const run = (): void => {
        if (matchesStream(params) && params.streamId === streamIdResolved) handler(params);
      };
      if (streamIdResolved === undefined) {
        early.push(run);
        return;
      }
      run();
    };

  const onToken = whenMatched((params) => {
    const text = (params as { text?: unknown }).text;
    if (typeof text === "string") push({ type: "token", text });
  });
  const onDone = whenMatched((params) => {
    const meta = (params as { meta?: { reply?: unknown; sessionId?: unknown } }).meta ?? {};
    const reply = typeof meta.reply === "string" ? meta.reply : "";
    const sessionId = typeof meta.sessionId === "string" ? meta.sessionId : "";
    push({ type: "done", reply, sessionId });
    finish();
  });
  const onError = whenMatched((params) => {
    const p = params as { code?: unknown; error?: unknown };
    const code = typeof p.code === "string" ? p.code : "stream_error";
    const message = typeof p.error === "string" ? p.error : "Stream error";
    push({ type: "error", code, message });
    finish();
  });
  const onSubTask = whenMatched((params) => {
    const p = params as { subTaskId?: unknown; status?: unknown; progress?: unknown };
    if (typeof p.subTaskId !== "string" || typeof p.status !== "string") return;
    const ev: StreamEvent =
      typeof p.progress === "number"
        ? {
            type: "subTaskProgress",
            subTaskId: p.subTaskId,
            status: p.status,
            progress: p.progress,
          }
        : { type: "subTaskProgress", subTaskId: p.subTaskId, status: p.status };
    push(ev);
  });
  const onHitl = whenMatched((params) => {
    const p = params as { requestId?: unknown; prompt?: unknown; details?: unknown };
    if (typeof p.requestId !== "string" || typeof p.prompt !== "string") return;
    push({ type: "hitlBatch", requestId: p.requestId, prompt: p.prompt, details: p.details });
  });

  // Register notification handlers *before* sending engine.askStream. The RPC
  // response and the first stream notifications flow over the same socket and are
  // dispatched synchronously line-by-line, so a handler attached only after the
  // awaited response would miss tokens delivered in the same chunk.
  const register = (method: string, handler: (p: unknown) => void): void => {
    ipc.onNotification(method, handler);
    unsubscribers.push(() => ipc.offNotification(method, handler));
  };
  register("engine.streamToken", onToken);
  register("engine.streamDone", onDone);
  register("engine.streamError", onError);
  register("agent.subTaskProgress", onSubTask);
  register("agent.hitlBatch", onHitl);

  const onAbort = (): void => {
    cancelled = true;
    const sid = streamIdResolved;
    if (sid !== undefined) void cancelUpstream(sid);
    finish();
  };

  const startPromise = (async (): Promise<string> => {
    const params: Record<string, unknown> = { input };
    if (opts.sessionId !== undefined) params["sessionId"] = opts.sessionId;
    if (opts.agent !== undefined) params["agent"] = opts.agent;
    const result = await ipc.call<{ streamId?: string }>("engine.askStream", params);
    const sid = result?.streamId;
    if (typeof sid !== "string") {
      push({ type: "error", code: "no_stream_id", message: "Gateway returned no streamId" });
      finish();
      throw new Error("no_stream_id");
    }
    streamIdResolved = sid;
    // Replay notifications that arrived before the streamId was known.
    const buffered = early;
    early = [];
    for (const run of buffered) run();
    // A cancel/return that fired before the id resolved still needs to reach the
    // gateway now that we know the streamId — check this before the `done` guard.
    if (cancelled) {
      await cancelUpstream(sid);
      finish();
      return sid;
    }
    if (done) return sid;
    if (opts.signal !== undefined) {
      const signal = opts.signal;
      if (signal.aborted) {
        await cancelUpstream(sid);
        finish();
      } else {
        signal.addEventListener("abort", onAbort, { once: true });
        unsubscribers.push(() => signal.removeEventListener("abort", onAbort));
      }
    }
    return sid;
  })();

  startPromise.catch((err: unknown) => {
    // A failed stream start (transport/RPC rejection) surfaces as an error event
    // so a `for await` consumer can distinguish it from a clean empty stream.
    // No-op if the stream already finished (e.g. the no_stream_id path above).
    push({
      type: "error",
      code: "stream_start_failed",
      message: err instanceof Error ? err.message : String(err),
    });
    finish();
  });

  const handle: AskStreamHandle = {
    /** Empty string until engine.askStream resolves; safe to read after the first awaited event. */
    get streamId(): string {
      return streamIdResolved ?? "";
    },
    async cancel(): Promise<void> {
      cancelled = true;
      const sid = streamIdResolved;
      if (sid !== undefined) await cancelUpstream(sid);
      finish();
    },
    [Symbol.asyncIterator](): AsyncIterator<StreamEvent> {
      return {
        next(): Promise<IteratorResult<StreamEvent>> {
          if (queue.length > 0) {
            const ev = queue.shift() as StreamEvent;
            return Promise.resolve({ value: ev, done: false });
          }
          if (done) {
            return Promise.resolve({ value: undefined as unknown as StreamEvent, done: true });
          }
          return new Promise<IteratorResult<StreamEvent>>((resolve, reject) => {
            waiters.push({ resolve, reject });
          });
        },
        return(): Promise<IteratorResult<StreamEvent>> {
          // Breaking out of `for await` must also tell the gateway to stop.
          cancelled = true;
          const sid = streamIdResolved;
          if (sid !== undefined) void cancelUpstream(sid);
          finish();
          return Promise.resolve({ value: undefined as unknown as StreamEvent, done: true });
        },
      };
    },
  };

  return handle;
}
