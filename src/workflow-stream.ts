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
 * immediately and every notification carries it, so several streams can share one
 * connection. `workflow.run` is a single RPC that resolves with the final
 * `WorkflowRunResult`, and its chunks arrive on the untagged `agent.chunk`
 * (`{ text }`) — the very same method `engine.askStream` and `agent.invoke` use,
 * with nothing to attribute a chunk to a particular run.
 *
 * The consequence is load-bearing and cannot be fixed from this side: while this
 * handle is live it receives EVERY `agent.chunk` on the connection. Run one
 * streaming workflow at a time per connection, and do not interleave it with a
 * streaming `ask` — use a second client if you need both at once. Adding a stream
 * id to the gateway's workflow chunks is what would lift this.
 *
 * There is also no cancel: the gateway exposes no `workflow.cancel`. Breaking out
 * of the `for await` detaches the listener, but the run continues server-side and
 * `result` still settles.
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
