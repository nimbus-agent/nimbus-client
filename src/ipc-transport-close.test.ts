import { afterEach, describe, expect, it } from "bun:test";

import { closeTestServers, serveAndCapture, tempEndpoint } from "../test/_socket-harness.ts";
import { IPCClient } from "./ipc-transport.js";

/**
 * End-to-end over a REAL socket, matching the sibling transport tests.
 *
 * `onClose` exists for a failure the unit level cannot show: a caller awaiting a
 * NOTIFICATION has no `requestTimeoutMs` protecting it, because the `call()`
 * that started the work already resolved. Only a genuine transport death
 * reproduces that, so these drive a real server and kill it.
 */

afterEach(closeTestServers);

/** Resolves once the handler has been invoked, or rejects after `ms`. */
function firstCall(ms: number): {
  seen: Promise<Error>;
  handler: (err: Error) => void;
} {
  let settle: (e: Error) => void = () => undefined;
  const seen = new Promise<Error>((resolve, reject) => {
    settle = resolve;
    setTimeout(() => {
      reject(new Error(`onClose did not fire within ${String(ms)}ms`));
    }, ms);
  });
  return {
    seen,
    handler: (err) => {
      settle(err);
    },
  };
}

describe("IPCClient.onClose", () => {
  it("fires with an Error when the gateway dies underneath a notification wait", async () => {
    const endpoint = tempEndpoint("nimbus-close-test");
    const { socket } = await serveAndCapture(endpoint);
    const client = new IPCClient(endpoint);
    await client.connect();

    const { seen, handler } = firstCall(2000);
    client.onClose(handler);

    // No pending call() — this is precisely the state `failAll` cannot help,
    // and the one a long-running job's client sits in while awaiting its
    // completion notification.
    (await socket).destroy();

    const err = await seen;
    expect(err).toBeInstanceOf(Error);
    expect(err.message.length).toBeGreaterThan(0);
    await client.disconnect();
  });

  it("does NOT fire on a deliberate disconnect()", async () => {
    const endpoint = tempEndpoint("nimbus-close-test");
    await serveAndCapture(endpoint);
    const client = new IPCClient(endpoint);
    await client.connect();

    let calls = 0;
    client.onClose(() => {
      calls += 1;
    });

    await client.disconnect();
    // The socket teardown disconnect() triggers is asynchronous; give the
    // event loop a turn so a wrongly-wired handler would have fired by now.
    await Bun.sleep(50);

    expect(calls).toBe(0);
  });

  it("stops firing after offClose", async () => {
    const endpoint = tempEndpoint("nimbus-close-test");
    const { socket } = await serveAndCapture(endpoint);
    const client = new IPCClient(endpoint);
    await client.connect();

    let calls = 0;
    const handler = (): void => {
      calls += 1;
    };
    client.onClose(handler);
    client.offClose(handler);

    (await socket).destroy();
    await Bun.sleep(100);

    expect(calls).toBe(0);
    await client.disconnect();
  });

  it("invokes every handler even when one throws", async () => {
    const endpoint = tempEndpoint("nimbus-close-test");
    const { socket } = await serveAndCapture(endpoint);
    const client = new IPCClient(endpoint);
    await client.connect();

    const order: string[] = [];
    client.onClose(() => {
      order.push("first");
      throw new Error("handler blew up");
    });
    client.onClose(() => {
      order.push("second");
    });

    (await socket).destroy();
    await Bun.sleep(100);

    // Without the try/catch the throw would escape into the socket event and
    // "second" would never run.
    expect(order).toEqual(["first", "second"]);
    await client.disconnect();
  });

  it("still invokes a handler a sibling removed DURING notification", async () => {
    const endpoint = tempEndpoint("nimbus-close-test");
    const { socket } = await serveAndCapture(endpoint);
    const client = new IPCClient(endpoint);
    await client.connect();

    const fired: string[] = [];
    const b = (): void => {
      fired.push("b");
    };
    // `a` is registered FIRST so its offClose(b) lands on an entry the loop has
    // not reached yet — a Set entry deleted before it is visited is skipped by
    // a live iteration, which is precisely the case the snapshot copy in
    // `notifyClosed` exists to defend. This is the shape a real consumer hits
    // when one close handler tears down a subsystem that unregistered another.
    const a = (): void => {
      fired.push("a");
      client.offClose(b);
    };
    client.onClose(a);
    client.onClose(b);

    (await socket).destroy();
    await Bun.sleep(100);

    // Iterating `this.closeHandlers` directly instead of `new Set(...)` drops
    // "b" here: every handler registered for THIS close must still be told the
    // transport died, or it waits on a notification that can never arrive.
    expect(fired).toEqual(["a", "b"]);
    await client.disconnect();
  });

  it("rejects a pending call AND notifies close, in that order", async () => {
    const endpoint = tempEndpoint("nimbus-close-test");
    const { socket } = await serveAndCapture(endpoint);
    const client = new IPCClient(endpoint);
    await client.connect();

    const order: string[] = [];
    client.onClose(() => {
      order.push("close");
    });
    const pending = client.call("never.answered").catch(() => {
      order.push("reject");
    });

    (await socket).destroy();
    await pending;
    await Bun.sleep(50);

    // Close fires FIRST from the outside, and that is correct rather than a
    // quirk: `failAll` settles the pending promise synchronously before
    // `notifyClosed` runs, but the consumer's `.catch()` continuation is a
    // microtask, so it lands after the synchronous handler. Asserting the
    // intuitive ["reject", "close"] here would pin a false claim about what a
    // caller observes.
    expect(order).toEqual(["close", "reject"]);
    await client.disconnect();
  });
});
