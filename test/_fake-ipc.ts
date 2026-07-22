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
  constructor(responses: unknown[] = []) {
    this.responses = responses;
  }
  async call(method: string, params: unknown): Promise<unknown> {
    this.calls.push({ method, params });
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
  async disconnect(): Promise<void> {
    /* no-op fake */
  }
}

export function makeClient(ipc: FakeIpc): NimbusClient {
  return new (NimbusClient as unknown as new (ipc: unknown) => NimbusClient)(ipc);
}
