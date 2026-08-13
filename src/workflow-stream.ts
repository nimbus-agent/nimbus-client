import { randomUUID } from "node:crypto";

import type { IPCClient } from "./ipc-transport.js";
import type { WorkflowRunResult } from "./nimbus-client.js";
import type {
  WorkflowRunEvent,
  WorkflowRunStreamHandle,
  WorkflowRunStreamParams,
} from "./stream-events.js";

type Pending = {
  resolve: (v: IteratorResult<WorkflowRunEvent>) => void;
  reject: (e: Error) => void;
};

/**
 * Stream a workflow run's per-step output.
 *
 * Shape note — this is NOT `askStream`. `engine.askStream` returns a `streamId`
 * immediately and every notification carries it. `workflow.run` is a single RPC
 * that resolves only with the final `WorkflowRunResult`, so a gateway-minted id
 * could never arrive in time. The CLIENT therefore mints the id here, sends it
 * with the run, and filters `agent.chunk` by it — which is also what makes the
 * run cancellable.
 *
 * Chunks with no `streamId` are accepted rather than dropped. A gateway that
 * predates chunk tagging emits bare `{ text }`, and filtering those out would
 * silently produce an empty stream; against such a gateway the old caveat still
 * holds — one streaming workflow at a time per connection, not interleaved with
 * a streaming `ask` — because its chunks genuinely cannot be told apart. Chunks
 * tagged for a DIFFERENT run are always ignored.
 */
export function createWorkflowRunStream(
  ipc: IPCClient,
  params: WorkflowRunStreamParams,
  validate: (method: string, raw: unknown) => WorkflowRunResult,
): WorkflowRunStreamHandle {
  const queue: WorkflowRunEvent[] = [];
  const waiters: Pending[] = [];
  let done = false;
  let detach: (() => void) | undefined;
  // Minted, not received: workflow.run resolves too late for a gateway id to be
  // useful. Unique per run — the gateway rejects reuse of a live id with -32602.
  const streamId = params.streamId ?? randomUUID();

  const push = (ev: WorkflowRunEvent): void => {
    if (done) return;
    const w = waiters.shift();
    if (w !== undefined) {
      w.resolve({ value: ev, done: false });
      return;
    }
    queue.push(ev);
  };

  const finish = (): void => {
    if (done) return;
    done = true;
    detach?.();
    detach = undefined;
    let w = waiters.shift();
    while (w !== undefined) {
      w.resolve({ value: undefined as unknown as WorkflowRunEvent, done: true });
      w = waiters.shift();
    }
  };

  const onChunk = (p: unknown): void => {
    if (typeof p !== "object" || p === null) return;
    const tag = (p as { streamId?: unknown }).streamId;
    // An absent tag means an older gateway that cannot tag at all — take it.
    // A tag that is not ours belongs to another run or a concurrent ask.
    if (typeof tag === "string" && tag !== streamId) return;
    const text = (p as { text?: unknown }).text;
    if (typeof text === "string") push({ type: "chunk", text });
  };

  // Subscribe BEFORE sending the RPC. The response and the first notifications
  // travel the same socket and are dispatched line-by-line, so a listener attached
  // after the await would miss chunks delivered in the same read.
  ipc.onNotification("agent.chunk", onChunk);
  detach = () => ipc.offNotification("agent.chunk", onChunk);

  const result: Promise<WorkflowRunResult> = (async () => {
    try {
      const raw = await ipc.call("workflow.run", {
        name: params.name,
        triggeredBy: params.triggeredBy,
        dryRun: params.dryRun,
        // The whole point of this handle — never let a caller turn it off here.
        stream: true,
        sessionId: params.sessionId,
        agent: params.agent,
        paramsOverride: params.paramsOverride,
        streamId,
      });
      return validate("workflow.run", raw);
    } finally {
      // Detach as soon as the run settles, even on rejection: a leaked handler
      // keeps a finished run's listener firing on later chunks.
      detach?.();
      detach = undefined;
    }
  })() as WorkflowRunStreamHandle["result"];

  result.then(
    (value) => {
      push({ type: "done", result: value });
      finish();
    },
    (err: unknown) => {
      push({ type: "error", message: err instanceof Error ? err.message : String(err) });
      finish();
    },
  );

  return {
    result,
    streamId,
    async cancel(): Promise<{ cancelled: boolean }> {
      // Deliberately does NOT finish() the stream. Cancellation lands at the
      // next step boundary, so the run keeps emitting and then settles with
      // status "cancelled" — closing here would drop that terminal result,
      // which is the only confirmation the cancel took effect.
      try {
        const raw = await ipc.call("workflow.cancel", { streamId });
        const flag = (raw as { cancelled?: unknown } | null)?.cancelled;
        return { cancelled: flag === true };
      } catch {
        // A gateway with no workflow.cancel rejects the method. Nothing was
        // cancelled, and the run carries on — report that rather than throw.
        return { cancelled: false };
      }
    },
    [Symbol.asyncIterator](): AsyncIterator<WorkflowRunEvent> {
      return {
        next(): Promise<IteratorResult<WorkflowRunEvent>> {
          const ev = queue.shift();
          if (ev !== undefined) return Promise.resolve({ value: ev, done: false });
          if (done) {
            return Promise.resolve({ value: undefined as unknown as WorkflowRunEvent, done: true });
          }
          return new Promise<IteratorResult<WorkflowRunEvent>>((resolve, reject) => {
            waiters.push({ resolve, reject });
          });
        },
        return(): Promise<IteratorResult<WorkflowRunEvent>> {
          // Detaches the listener; the run itself keeps going (no workflow.cancel).
          finish();
          return Promise.resolve({ value: undefined as unknown as WorkflowRunEvent, done: true });
        },
      };
    },
  };
}
