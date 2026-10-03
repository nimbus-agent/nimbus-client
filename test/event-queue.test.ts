import { describe, expect, test } from "bun:test";

import { createEventQueue } from "../src/event-queue.ts";

const PARKED = Symbol("parked");

/**
 * `p`'s value if it has already settled, else `PARKED`, with no timer involved:
 * `Promise.race` subscribes to its inputs in order, so an already-settled `p` wins
 * against the already-resolved sentinel and a pending one loses to it.
 */
function settledOrParked<T>(p: Promise<T>): Promise<T | typeof PARKED> {
  return Promise.race([p, Promise.resolve(PARKED)]);
}

describe("createEventQueue", () => {
  test("buffers events pushed while nobody is waiting and yields them in order", async () => {
    const q = createEventQueue<string>();
    q.push("a");
    q.push("b");
    expect(await q.next()).toEqual({ value: "a", done: false });
    expect(await q.next()).toEqual({ value: "b", done: false });
  });

  test("an empty, open queue parks next() until a push arrives", async () => {
    const q = createEventQueue<string>();
    const pending = q.next();
    expect(await settledOrParked(pending)).toBe(PARKED);
    q.push("a");
    expect(await settledOrParked(pending)).toEqual({ value: "a", done: false });
  });

  test("serves parked next() calls oldest first", async () => {
    const q = createEventQueue<string>();
    const first = q.next();
    const second = q.next();
    q.push("a");
    q.push("b");
    expect(await first).toEqual({ value: "a", done: false });
    expect(await second).toEqual({ value: "b", done: false });
  });

  test("close() settles EVERY parked next() with done, not only the first", async () => {
    // Three, so a close() that settled only the head would leave two still parked.
    const q = createEventQueue<string>();
    const parked = [q.next(), q.next(), q.next()];
    q.close();
    expect(await Promise.all(parked.map(settledOrParked))).toEqual([
      { value: undefined, done: true },
      { value: undefined, done: true },
      { value: undefined, done: true },
    ]);
  });

  test("events buffered before close() still drain, then next() reports done", async () => {
    // This is how a stream's terminal event reaches the consumer: the handle pushes
    // it and then closes the queue.
    const q = createEventQueue<string>();
    q.push("last");
    q.close();
    expect(await q.next()).toEqual({ value: "last", done: false });
    expect(await q.next()).toEqual({ value: undefined, done: true });
    expect(await q.next()).toEqual({ value: undefined, done: true });
  });

  test("push() after close() is dropped", async () => {
    const q = createEventQueue<string>();
    q.close();
    q.push("late");
    expect(await q.next()).toEqual({ value: undefined, done: true });
  });

  test("closed is false until close() runs", () => {
    const q = createEventQueue<string>();
    expect(q.closed).toBe(false);
    q.close();
    expect(q.closed).toBe(true);
  });

  test("close() runs its teardown once, with the queue already closed", async () => {
    const q = createEventQueue<string>();
    let runs = 0;
    let closedDuringTeardown: boolean | undefined;
    const teardown = (): void => {
      runs += 1;
      closedDuringTeardown = q.closed;
      // Already closed, so an event the teardown provokes is dropped, not delivered.
      q.push("from teardown");
    };
    q.close(teardown);
    q.close(teardown);
    expect(runs).toBe(1);
    expect(closedDuringTeardown).toBe(true);
    expect(await q.next()).toEqual({ value: undefined, done: true });
  });
});
