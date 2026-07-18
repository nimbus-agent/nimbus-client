import type { NimbusItem } from "@nimbus-dev/sdk";

import type {
  EgressHead,
  EgressListParams,
  EgressListResult,
  EgressProveWindowParams,
  EgressProveWindowResult,
  EgressRow,
  EgressVerifyResult,
  NimbusClientLike,
  RankedSearchItem,
  RankedSearchParams,
  SessionTranscript,
} from "./nimbus-client.js";
import type {
  AskStreamHandle,
  AskStreamOptions,
  HitlRequest,
  StreamEvent,
} from "./stream-events.js";

export type MockClientFixtures = {
  items?: NimbusItem[];
  rankedItems?: RankedSearchItem[];
  streamTokens?: string[];
  reply?: string;
  sqlRows?: Record<string, unknown>[];
  egressHead?: EgressHead;
  egressRows?: EgressRow[];
  egressVerify?: EgressVerifyResult;
  egressProveWindow?: EgressProveWindowResult;
};

/**
 * In-memory stub for scripts/tests without a running Gateway.
 * Implements {@link NimbusClientLike}, so it stays in sync with the real client.
 */
export class MockClient implements NimbusClientLike {
  private readonly fixtures: MockClientFixtures;

  constructor(fixtures: MockClientFixtures = {}) {
    this.fixtures = fixtures;
  }

  async agentInvoke(
    _input: string,
    _options?: { stream?: boolean; sessionId?: string; agent?: string },
  ): Promise<{ reply?: string } & Record<string, unknown>> {
    return { reply: this.fixtures.reply ?? "[MockClient] agent.invoke" };
  }

  askStream(_input: string, _opts?: AskStreamOptions): AskStreamHandle {
    const tokens = this.fixtures.streamTokens ?? ["mock", " token"];
    const reply = this.fixtures.reply ?? tokens.join("");
    let i = 0;
    let cancelled = false;
    const handle: AskStreamHandle = {
      streamId: "mock-stream",
      async cancel(): Promise<void> {
        cancelled = true;
      },
      [Symbol.asyncIterator](): AsyncIterator<StreamEvent> {
        return {
          async next(): Promise<IteratorResult<StreamEvent>> {
            if (cancelled) return { value: undefined, done: true };
            if (i < tokens.length) {
              const text = tokens[i] as string;
              i += 1;
              return { value: { type: "token", text }, done: false };
            }
            if (i === tokens.length) {
              i += 1;
              return {
                value: { type: "done", reply, sessionId: "mock-session" },
                done: false,
              };
            }
            return { value: undefined, done: true };
          },
        };
      },
    };
    return handle;
  }

  subscribeHitl(_handler: (req: HitlRequest) => void): { dispose(): void } {
    return { dispose: () => undefined };
  }

  async getSessionTranscript(_params: {
    sessionId: string;
    limit?: number;
  }): Promise<SessionTranscript> {
    return { sessionId: "mock-session", turns: [], hasMore: false };
  }

  async cancelStream(): Promise<{ ok: boolean }> {
    return { ok: true };
  }

  async queryItems(_params: {
    services?: string[];
    types?: string[];
    sinceMs?: number;
    untilMs?: number;
    limit?: number;
  }): Promise<{ items: Record<string, unknown>[]; meta: { limit: number; total: number } }> {
    const items = (this.fixtures.items ?? []) as unknown as Record<string, unknown>[];
    return { items, meta: { limit: items.length, total: items.length } };
  }

  async searchRanked(_params?: RankedSearchParams): Promise<RankedSearchItem[]> {
    return this.fixtures.rankedItems ?? [];
  }

  async querySql(_sql: string): Promise<{ rows: Record<string, unknown>[] }> {
    return { rows: this.fixtures.sqlRows ?? [] };
  }

  async auditList(_limit?: number): Promise<unknown[]> {
    return [];
  }

  async egressHead(): Promise<EgressHead> {
    return this.fixtures.egressHead ?? { head: "", count: 0 };
  }

  async egressList(_params?: EgressListParams): Promise<EgressListResult> {
    return { rows: this.fixtures.egressRows ?? [] };
  }

  async egressVerify(): Promise<EgressVerifyResult> {
    return this.fixtures.egressVerify ?? { ok: true, verifiedRows: 0 };
  }

  async egressProveWindow(_params?: EgressProveWindowParams): Promise<EgressProveWindowResult> {
    return (
      this.fixtures.egressProveWindow ?? {
        rows: [],
        completeness: { tier: "authorized-actions", outboundEgressEvents: 0 },
        verify: { ok: true, verifiedRows: 0 },
      }
    );
  }

  async close(): Promise<void> {
    /* noop */
  }
}
