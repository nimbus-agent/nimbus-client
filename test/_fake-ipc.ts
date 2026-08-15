import type { IPCClient } from "../src/ipc-transport.ts";
import { NimbusClient } from "../src/nimbus-client.ts";

/**
 * Shared test harness for `NimbusClient` unit tests: a fake transport that
 * queues call responses and lets tests emit notifications synchronously.
 * Extracted from `nimbus-client.test.ts` so `agents-wrapper.test.ts` (and any
 * future dispatch test) can reuse it instead of duplicating the fake.
 */

export type CallSpy = { method: string; params: unknown };

export class FakeIpc {
  public calls: CallSpy[] = [];
  public notifHandlers = new Map<string, ((p: unknown) => void)[]>();
  private readonly responses: unknown[];
  private readonly byMethod = new Map<string, unknown>();
  private readonly rejections = new Map<string, string>();
  private readonly gates = new Map<string, Promise<void>>();
  constructor(responses: unknown[] = []) {
    this.responses = responses;
  }
  /**
   * Answer `method` with `value` regardless of call order. The positional
   * queue stays the default; this is for tests where two different methods
   * interleave and a FIFO queue would couple the fixture to call ordering.
   */
  setResponse(method: string, value: unknown): void {
    this.byMethod.set(method, value);
  }
  /** Make `method` reject — e.g. an RPC the Gateway does not implement. */
  failMethod(method: string, message: string): void {
    this.rejections.set(method, message);
  }
  /**
   * Hold `method`'s response open until the returned release function is
   * called, so a test can act while the call is still in flight.
   */
  deferMethod(method: string, value: unknown): () => void {
    let release = (): void => {};
    this.gates.set(
      method,
      new Promise<void>((resolve) => {
        release = () => {
          resolve();
        };
      }),
    );
    this.byMethod.set(method, value);
    return () => {
      release();
    };
  }
  async call(method: string, params: unknown): Promise<unknown> {
    this.calls.push({ method, params });
    const gate = this.gates.get(method);
    if (gate !== undefined) await gate;
    const rejection = this.rejections.get(method);
    if (rejection !== undefined) throw new Error(rejection);
    if (this.byMethod.has(method)) return this.byMethod.get(method);
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
  // Mirrors IPCClient's close surface. `askStream` binds this to end a stream
  // when the transport dies — without it here, any test that starts a stream
  // through this fake throws "ipc.onClose is not a function".
  public closeHandlers = new Set<(err: Error) => void>();
  onClose(handler: (err: Error) => void): void {
    this.closeHandlers.add(handler);
  }
  offClose(handler: (err: Error) => void): void {
    this.closeHandlers.delete(handler);
  }
  /** Simulate an unexpected transport close. */
  emitClose(err = new Error("socket closed")): void {
    for (const h of [...this.closeHandlers]) h(err);
  }
  async disconnect(): Promise<void> {
    /* no-op fake */
  }
}

export function makeClient(ipc: FakeIpc): NimbusClient {
  return new (NimbusClient as unknown as new (ipc: unknown) => NimbusClient)(ipc);
}

/**
 * Hand the fake to a helper that takes a real `IPCClient`. Only the four
 * transport members the stream helpers touch are actually exercised.
 */
export function asIpc(ipc: FakeIpc): IPCClient {
  return ipc as unknown as IPCClient;
}
