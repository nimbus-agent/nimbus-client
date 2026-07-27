// Type-only module: NO executable runtime logic. It is exact-path-excluded from the coverage floor
// in scripts/coverage-floor/exclusions.ts (a type-only file emits no SF: lcov record). Adding runtime
// logic here would silently bypass the floor — put runtime logic in a separate, covered module.
import type { WorkflowRunParams, WorkflowRunResult } from "./nimbus-client.js";

/**
 * Events emitted by NimbusClient.askStream() over its AsyncIterable surface.
 * Single discriminated union so the consumer can `switch (ev.type)`.
 */
export type StreamEvent =
  | { readonly type: "token"; readonly text: string }
  | {
      readonly type: "subTaskProgress";
      readonly subTaskId: string;
      readonly status: string;
      readonly progress?: number;
    }
  | {
      readonly type: "hitlBatch";
      readonly requestId: string;
      readonly prompt: string;
      readonly details?: unknown;
    }
  | { readonly type: "done"; readonly reply: string; readonly sessionId: string }
  | { readonly type: "error"; readonly code: string; readonly message: string };

export type AskStreamOptions = {
  sessionId?: string;
  agent?: string;
  signal?: AbortSignal;
};

/**
 * Returned from NimbusClient.askStream(). Iterate to consume events;
 * call cancel() to terminate the stream early.
 */
export type AskStreamHandle = AsyncIterable<StreamEvent> & {
  readonly streamId: string;
  cancel(): Promise<void>;
};

/**
 * Parameters for NimbusClient.workflowRunStream(). Same as WorkflowRunParams
 * minus `stream`, which the handle always sets — asking for the stream and then
 * disabling it is not a state worth representing.
 */
export type WorkflowRunStreamParams = Omit<WorkflowRunParams, "stream">;

/**
 * Events emitted by NimbusClient.workflowRunStream() over its AsyncIterable
 * surface. `done` carries the same value `workflowRun()` would have resolved to,
 * so a caller can render progress and still get the final result.
 */
export type WorkflowRunEvent =
  | { readonly type: "chunk"; readonly text: string }
  | { readonly type: "done"; readonly result: WorkflowRunResult }
  | { readonly type: "error"; readonly message: string };

/**
 * Returned from NimbusClient.workflowRunStream().
 *
 * No `cancel()` — the gateway has no `workflow.cancel`, so offering one would be
 * a lie. Breaking out of the `for await` detaches the chunk listener; the run
 * continues server-side and `result` still settles.
 *
 * `result` rejects on a failed run exactly as `workflowRun()` does; the iterator
 * reports the same failure as a terminal `error` event instead. Consume one or the
 * other — awaiting `result` without a `catch` while only iterating will surface an
 * unhandled rejection.
 */
export type WorkflowRunStreamHandle = AsyncIterable<WorkflowRunEvent> & {
  readonly result: Promise<WorkflowRunResult>;
};

/**
 * HITL request payload delivered via NimbusClient.subscribeHitl().
 * Independent of any stream — used for background workflow / watcher HITL.
 */
export type HitlRequest = {
  readonly requestId: string;
  readonly prompt: string;
  readonly details?: unknown;
  /** Present only when the batch was produced by a known stream. */
  readonly streamId?: string;
};
