/**
 * The push-to-pull buffer behind `askStream` and `workflowRunStream`.
 *
 * Both handles turn Gateway notifications, which arrive whenever the Gateway sends
 * them, into an `AsyncIterator` that a consumer pulls with `for await`. That bridge is
 * the same in both, so it lives here once. What differs between them (which
 * notifications feed it, and what ending the stream tears down) stays in each handle
 * and reaches the queue as the `teardown` passed to {@link EventQueue.close}.
 */
export type EventQueue<T> = {
  /** Hand `ev` to the oldest parked {@link EventQueue.next}, or buffer it. A no-op once closed. */
  push(ev: T): void;
  /**
   * End the stream. Only the first call does anything: it marks the queue closed, runs
   * `teardown`, then settles EVERY parked `next()` with `done` (not just the first,
   * since nothing else will ever settle the rest).
   */
  close(teardown?: () => void): void;
  /** Whether {@link EventQueue.close} has run. */
  readonly closed: boolean;
  /**
   * The next event. Events buffered before {@link EventQueue.close} still drain after
   * it, which is how a terminal event pushed just before closing reaches the consumer.
   * An empty, closed queue reports `done`; an empty, open one parks until a push or close.
   */
  next(): Promise<IteratorResult<T>>;
};

export function createEventQueue<T>(): EventQueue<T> {
  const buffer: T[] = [];
  const waiters: Array<(result: IteratorResult<T>) => void> = [];
  let closed = false;

  return {
    push(ev: T): void {
      if (closed) return;
      const waiter = waiters.shift();
      if (waiter !== undefined) {
        waiter({ value: ev, done: false });
        return;
      }
      buffer.push(ev);
    },
    close(teardown?: () => void): void {
      if (closed) return;
      closed = true;
      teardown?.();
      let waiter = waiters.shift();
      while (waiter !== undefined) {
        waiter({ value: undefined, done: true });
        waiter = waiters.shift();
      }
    },
    get closed(): boolean {
      return closed;
    },
    next(): Promise<IteratorResult<T>> {
      if (buffer.length > 0) {
        return Promise.resolve({ value: buffer.shift() as T, done: false });
      }
      if (closed) return Promise.resolve({ value: undefined, done: true });
      return new Promise<IteratorResult<T>>((resolve) => {
        waiters.push(resolve);
      });
    },
  };
}
