import type {
  AgentName,
  BriefFor,
  CatchupBrief,
  ConflictBrief,
  ExpertBrief,
  GhostBrief,
  HuddleBrief,
  ImpactBrief,
  JanitorBrief,
  PreflightBrief,
} from "@nimbus-dev/sdk";

import type {
  AgentBriefEvent,
  CatchupParams,
  ConflictsParams,
  ExpertParams,
  GhostParams,
  HuddleParams,
  ImpactParams,
  JanitorParams,
  PreflightParams,
} from "./agents.js";
import type {
  EgressHead,
  EgressListParams,
  EgressListResult,
  EgressProveWindowParams,
  EgressProveWindowResult,
  EgressRow,
  EgressVerifyResult,
  IndexedItem,
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
  items?: IndexedItem[];
  rankedItems?: RankedSearchItem[];
  streamTokens?: string[];
  reply?: string;
  sqlRows?: Record<string, unknown>[];
  egressHead?: EgressHead;
  egressRows?: EgressRow[];
  egressVerify?: EgressVerifyResult;
  egressProveWindow?: EgressProveWindowResult;
  agentBriefs?: Partial<{
    expert: ExpertBrief;
    impact: ImpactBrief;
    catchup: CatchupBrief;
    ghost: GhostBrief;
    conflicts: ConflictBrief;
    huddle: HuddleBrief;
    janitor: JanitorBrief;
    preflight: PreflightBrief;
  }>;
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

  subscribeAgentBrief<A extends AgentName>(
    _agent: A,
    _handler: (ev: AgentBriefEvent<A>) => void,
  ): { dispose(): void } {
    return { dispose: () => {} };
  }

  private brief<A extends AgentName>(agent: A): Promise<BriefFor<A>> {
    const fixture = this.fixtures.agentBriefs?.[agent];
    if (fixture === undefined) {
      return Promise.reject(new Error(`MockClient: no agentBriefs.${agent} fixture configured`));
    }
    return Promise.resolve(fixture as BriefFor<A>);
  }

  async agentsExpert(_p: ExpertParams): Promise<ExpertBrief> {
    return this.brief("expert");
  }
  async agentsImpact(_p: ImpactParams): Promise<ImpactBrief> {
    return this.brief("impact");
  }
  async agentsCatchup(_p?: CatchupParams): Promise<CatchupBrief> {
    return this.brief("catchup");
  }
  async agentsGhost(_p: GhostParams): Promise<GhostBrief> {
    return this.brief("ghost");
  }
  async agentsConflicts(_p: ConflictsParams): Promise<ConflictBrief> {
    return this.brief("conflicts");
  }
  async agentsHuddle(_p?: HuddleParams): Promise<HuddleBrief> {
    return this.brief("huddle");
  }
  async agentsJanitor(_p: JanitorParams): Promise<JanitorBrief> {
    return this.brief("janitor");
  }
  async agentsPreflight(_p: PreflightParams): Promise<PreflightBrief> {
    return this.brief("preflight");
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
  }): Promise<{ items: IndexedItem[]; meta: { limit: number; total: number } }> {
    const items = this.fixtures.items ?? [];
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
