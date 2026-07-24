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
  WhyBrief,
  WhyPeek,
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
  WhyParams,
} from "./agents.js";
import type {
  AuditSummary,
  AuditToolCallsParams,
  AuditToolCallsResult,
  AuditVerifyParams,
  AuditVerifyResult,
  ConnectorAddMcpParams,
  ConnectorAddMcpResult,
  ConnectorAuthParams,
  ConnectorAuthResult,
  ConnectorHealthHistoryEntry,
  ConnectorHealthHistoryParams,
  ConnectorReindexParams,
  ConnectorReindexResult,
  ConnectorRemoveParams,
  ConnectorRemoveResult,
  ConnectorServiceParams,
  ConnectorSetConfigParams,
  ConnectorSetConfigResult,
  ConnectorSetIntervalParams,
  ConnectorStatusParams,
  ConnectorStatusResult,
  ConnectorSyncParams,
  ConnectorSyncStatus,
  ConsentRespondParams,
  DeployPreflightParams,
  DeployPreflightResult,
  DiagSnapshot,
  DiagVersion,
  DoraMetricsResult,
  EgressHead,
  EgressListParams,
  EgressListResult,
  EgressProveWindowParams,
  EgressProveWindowResult,
  EgressRow,
  EgressVerifyResult,
  GatewayPingResult,
  GatewayStatus,
  IndexedItem,
  IndexMetrics,
  MetricsDoraParams,
  NimbusClientLike,
  RankedSearchItem,
  RankedSearchParams,
  SessionAppendParams,
  SessionClearParams,
  SessionClearResult,
  SessionListResult,
  SessionRecallParams,
  SessionRecallResult,
  SessionTranscript,
  WorkflowDeleteParams,
  WorkflowListResult,
  WorkflowListRunsParams,
  WorkflowListRunsResult,
  WorkflowRunParams,
  WorkflowRunResult,
  WorkflowSaveParams,
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
  auditVerify?: AuditVerifyResult;
  auditSummary?: AuditSummary;
  auditToolCalls?: AuditToolCallsResult;
  egressHead?: EgressHead;
  egressRows?: EgressRow[];
  egressVerify?: EgressVerifyResult;
  egressProveWindow?: EgressProveWindowResult;
  gatewayPing?: GatewayPingResult;
  diagVersion?: DiagVersion;
  indexMetrics?: IndexMetrics;
  diagSnapshot?: DiagSnapshot;
  adminStatus?: GatewayStatus;
  sessionRecall?: SessionRecallResult;
  sessionList?: SessionListResult;
  metricsDora?: DoraMetricsResult;
  deployPreflight?: DeployPreflightResult;
  connectorSyncStatuses?: ConnectorSyncStatus[];
  connectorStatus?: ConnectorStatusResult;
  connectorHealthHistory?: ConnectorHealthHistoryEntry[];
  connectorSetConfig?: ConnectorSetConfigResult;
  connectorAuth?: ConnectorAuthResult;
  connectorAddMcp?: ConnectorAddMcpResult;
  connectorRemove?: ConnectorRemoveResult;
  connectorReindex?: ConnectorReindexResult;
  workflowList?: WorkflowListResult;
  workflowListRuns?: WorkflowListRunsResult;
  workflowRun?: WorkflowRunResult;
  agentBriefs?: Partial<{
    expert: ExpertBrief;
    impact: ImpactBrief;
    catchup: CatchupBrief;
    ghost: GhostBrief;
    conflicts: ConflictBrief;
    huddle: HuddleBrief;
    janitor: JanitorBrief;
    preflight: PreflightBrief;
    why: WhyBrief;
  }>;
  whyPeek?: WhyPeek;
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
  async agentsWhy(_p: WhyParams): Promise<WhyBrief> {
    return this.brief("why");
  }
  async agentsWhyPeek(_p: WhyParams): Promise<WhyPeek> {
    if (this.fixtures.whyPeek === undefined) {
      throw new Error("MockClient: no whyPeek fixture configured");
    }
    return this.fixtures.whyPeek;
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

  async sessionAppend(_params: SessionAppendParams): Promise<{ ok: boolean }> {
    return { ok: true };
  }

  async sessionRecall(_params: SessionRecallParams): Promise<SessionRecallResult> {
    return this.fixtures.sessionRecall ?? { chunks: [] };
  }

  async sessionList(): Promise<SessionListResult> {
    return this.fixtures.sessionList ?? { sessions: [] };
  }

  async sessionClear(_params?: SessionClearParams): Promise<SessionClearResult> {
    return { ok: true, cleared: "all" };
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

  async auditVerify(_params?: AuditVerifyParams): Promise<AuditVerifyResult> {
    return this.fixtures.auditVerify ?? { ok: true, verifiedRows: 0, lastVerifiedId: 0 };
  }

  async auditGetSummary(): Promise<AuditSummary> {
    return this.fixtures.auditSummary ?? { byOutcome: {}, byService: {}, total: 0 };
  }

  async auditToolCalls(_params?: AuditToolCallsParams): Promise<AuditToolCallsResult> {
    return this.fixtures.auditToolCalls ?? { toolCalls: [], hasMore: false, nextCursor: null };
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

  async consentRespond(_params: ConsentRespondParams): Promise<{ ok: boolean }> {
    return { ok: true };
  }

  async gatewayPing(_params?: { includeDrift?: boolean }): Promise<GatewayPingResult> {
    return (
      this.fixtures.gatewayPing ?? {
        version: "mock",
        uptime: 0,
        agentLimits: { maxAgentDepth: 5, maxToolCallsPerSession: 50 },
      }
    );
  }

  async diagGetVersion(): Promise<DiagVersion> {
    return (
      this.fixtures.diagVersion ?? { version: "mock", commit: null, buildId: null, uptimeMs: 0 }
    );
  }

  private defaultIndexMetrics(): IndexMetrics {
    return {
      itemCountByService: {},
      totalItems: 0,
      indexSizeBytes: 0,
      embeddingCoveragePercent: 0,
      lastSuccessfulSyncByConnector: {},
      queryLatencyP50Ms: 0,
      queryLatencyP95Ms: 0,
      queryLatencyP99Ms: 0,
    };
  }

  async indexMetrics(): Promise<IndexMetrics> {
    return this.fixtures.indexMetrics ?? this.defaultIndexMetrics();
  }

  async diagSnapshot(): Promise<DiagSnapshot> {
    return (
      this.fixtures.diagSnapshot ?? {
        gateway: { version: "mock", uptimeMs: 0 },
        connectorHealth: [],
        index: this.defaultIndexMetrics(),
        hitl: { pendingConsentRequests: 0 },
        watchers: [],
        auditLogTail: [],
        extensions: { disabled_pre_t2: 0, signature_disabled_count: 0 },
        sandbox: {
          platform_capabilities: { network: "all_or_nothing", reason: null },
          linux_helper: null,
          stale_rules_count: 0,
        },
      }
    );
  }

  async adminStatus(): Promise<GatewayStatus> {
    return (
      this.fixtures.adminStatus ?? {
        policy: { signatureValid: true, pendingRestart: false, source: "none" },
        peers: [],
        connectors: [],
        namespaces: [],
        audit: { chainLength: 0, lastHash: "", appendRate1h: 0 },
        hitl: { pendingApprovals: 0, pendingQuorum: 0 },
        identity: { operatorValid: true },
        syncFreshnessMs: 0,
      }
    );
  }

  async metricsDora(_params: MetricsDoraParams): Promise<DoraMetricsResult> {
    return (
      this.fixtures.metricsDora ?? {
        service: "mock",
        since_ms: 0,
        computed_at: new Date(0).toISOString(),
        metrics: {
          deployment_frequency: {
            value: null,
            unit: "deploys_per_day",
            sample: 0,
            gap: "no_repos",
          },
          lead_time_for_changes: {
            value: null,
            unit: "seconds_median",
            sample: 0,
            gap: "no_repos",
          },
          change_failure_rate: { value: null, unit: "ratio", sample: 0, gap: "no_repos" },
          mttr: { value: null, unit: "seconds_median", sample: 0, gap: "no_repos" },
        },
      }
    );
  }

  async deployPreflight(_params: DeployPreflightParams): Promise<DeployPreflightResult> {
    return (
      this.fixtures.deployPreflight ?? {
        service: "mock",
        target_ref: "main",
        computed_at: new Date(0).toISOString(),
        verdict: "ok",
        checks: {
          active_p1_incidents: { count: 0, findings: [], gap: "no_pagerduty_mapping" },
          failing_ci_runs: { count: 0, findings: [], gap: "no_repos" },
          merge_conflicts: { count: 0, findings: [], gap: "no_repos" },
        },
      }
    );
  }

  async connectorListStatus(_params?: { serviceId?: string }): Promise<ConnectorSyncStatus[]> {
    return this.fixtures.connectorSyncStatuses ?? [];
  }

  private defaultConnectorStatus(serviceId: string): ConnectorStatusResult {
    return {
      serviceId,
      status: "ok",
      lastSyncAt: null,
      nextSyncAt: null,
      intervalMs: 0,
      itemCount: 0,
      lastError: null,
      consecutiveFailures: 0,
      depth: "metadata_only",
      enabled: true,
    };
  }

  async connectorStatus(params: ConnectorStatusParams): Promise<ConnectorStatusResult> {
    return this.fixtures.connectorStatus ?? this.defaultConnectorStatus(params.serviceId);
  }

  async connectorHealthHistory(
    _params: ConnectorHealthHistoryParams,
  ): Promise<ConnectorHealthHistoryEntry[]> {
    return this.fixtures.connectorHealthHistory ?? [];
  }

  async connectorPause(_params: ConnectorServiceParams): Promise<{ ok: boolean }> {
    return { ok: true };
  }

  async connectorResume(_params: ConnectorServiceParams): Promise<{ ok: boolean }> {
    return { ok: true };
  }

  async connectorSetInterval(_params: ConnectorSetIntervalParams): Promise<{ ok: boolean }> {
    return { ok: true };
  }

  async connectorSetConfig(params: ConnectorSetConfigParams): Promise<ConnectorSetConfigResult> {
    return (
      this.fixtures.connectorSetConfig ?? {
        service: params.serviceId,
        intervalMs: params.intervalMs ?? null,
        depth: params.depth ?? null,
        enabled: params.enabled ?? null,
      }
    );
  }

  async connectorSync(_params: ConnectorSyncParams): Promise<{ ok: boolean }> {
    return { ok: true };
  }

  async connectorAuth(params: ConnectorAuthParams): Promise<ConnectorAuthResult> {
    return (
      this.fixtures.connectorAuth ?? { ok: true, serviceId: params.serviceId, scopesGranted: [] }
    );
  }

  async connectorAddMcp(params: ConnectorAddMcpParams): Promise<ConnectorAddMcpResult> {
    return this.fixtures.connectorAddMcp ?? { ok: true, serviceId: params.serviceId };
  }

  async connectorRemove(_params: ConnectorRemoveParams): Promise<ConnectorRemoveResult> {
    return this.fixtures.connectorRemove ?? { ok: true, itemsDeleted: 0, vaultKeysRemoved: [] };
  }

  async connectorReindex(params: ConnectorReindexParams): Promise<ConnectorReindexResult> {
    return (
      this.fixtures.connectorReindex ?? {
        itemsAffected: 0,
        depth: params.depth ?? "metadata_only",
        mode: "shallow",
      }
    );
  }

  async workflowList(): Promise<WorkflowListResult> {
    return this.fixtures.workflowList ?? { workflows: [] };
  }

  async workflowSave(_params: WorkflowSaveParams): Promise<{ id: string }> {
    return { id: "mock-workflow" };
  }

  async workflowDelete(_params: WorkflowDeleteParams): Promise<{ ok: boolean }> {
    return { ok: true };
  }

  async workflowListRuns(_params: WorkflowListRunsParams): Promise<WorkflowListRunsResult> {
    return this.fixtures.workflowListRuns ?? { runs: [] };
  }

  async workflowRun(params: WorkflowRunParams): Promise<WorkflowRunResult> {
    return (
      this.fixtures.workflowRun ?? {
        runId: "mock-run",
        dryRun: params.dryRun ?? false,
        stepResults: [],
      }
    );
  }

  async close(): Promise<void> {
    /* noop */
  }
}

/**
 * High-fidelity `WhyBrief` sample: one finding per `WhyLane`, for consumers
 * that want a realistic fixture instead of constructing their own. Null/empty
 * variants stay the consumer's own test to build (YAGNI) — this is the one
 * rich fixture the client ships.
 */
export const WHY_BRIEF_FIXTURE: WhyBrief = {
  agentVersion: 1,
  generatedAt: 1,
  latencyMs: 5,
  gaps: [],
  kind: "why",
  query: { ref: "src/retry.ts", line: 42 },
  subject: { repoRoot: "/repo", filePath: "src/retry.ts", lineNo: 42, symbol: "retryBackoff" },
  findings: (
    ["authorship", "pull_request", "ticket", "discussion", "driver", "downstream"] as const
  ).map((lane, i) => ({
    lane,
    title: `${lane} finding`,
    detail: `${lane} detail`,
    url: `https://x/${lane}`,
    occurredAt: 1_700_000_000_000 + i,
    entityId: `e${i}`,
  })),
};
