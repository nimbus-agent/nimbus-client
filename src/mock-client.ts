import type {
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
  SupportedAgentName,
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
  ConnectorConfigChanged,
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
  QueryItemsParams,
  QueryItemsResult,
  RankedSearchItem,
  RankedSearchParams,
  RankedSearchWithRetrieval,
  SearchRetrieval,
  SessionAppendParams,
  SessionClearParams,
  SessionClearResult,
  SessionListResult,
  SessionRecallParams,
  SessionRecallResult,
  SessionTranscript,
  WorkflowCancelParams,
  WorkflowCancelResult,
  WorkflowDeleteParams,
  WorkflowListResult,
  WorkflowListRunsParams,
  WorkflowListRunsResult,
  WorkflowRunParams,
  WorkflowRunResult,
  WorkflowSaveParams,
} from "./nimbus-client.js";
import { NO_EGRESS_COVERAGE } from "./nimbus-client.js";
import type {
  AskStreamHandle,
  AskStreamOptions,
  HitlRequest,
  StreamEvent,
  WorkflowRunEvent,
  WorkflowRunStreamHandle,
  WorkflowRunStreamParams,
} from "./stream-events.js";

export type MockClientFixtures = {
  items?: IndexedItem[];
  rankedItems?: RankedSearchItem[];
  /** The `retrieval` block `searchRankedWithRetrieval` reports. Default: a complete vector-ranked search. */
  rankedRetrieval?: SearchRetrieval | null;
  /** The notes `searchRankedWithRetrieval` reports. Default: none. */
  rankedNotes?: string[];
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
  /** Chunks replayed by {@link MockClient.workflowRunStream} before its `done` event. */
  workflowRunChunks?: string[];
  /** Answer for {@link MockClient.workflowCancel} and a stream handle's `cancel()`. */
  workflowCancel?: WorkflowCancelResult;
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

  agentInvoke(
    _input: string,
    _options?: { stream?: boolean; sessionId?: string; agent?: string },
  ): Promise<{ reply?: string } & Record<string, unknown>> {
    return Promise.resolve({ reply: this.fixtures.reply ?? "[MockClient] agent.invoke" });
  }

  askStream(_input: string, _opts?: AskStreamOptions): AskStreamHandle {
    const tokens = this.fixtures.streamTokens ?? ["mock", " token"];
    const reply = this.fixtures.reply ?? tokens.join("");
    let i = 0;
    let cancelled = false;
    const nextResult = (): IteratorResult<StreamEvent> => {
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
    };
    const handle: AskStreamHandle = {
      streamId: "mock-stream",
      cancel(): Promise<void> {
        cancelled = true;
        return Promise.resolve();
      },
      [Symbol.asyncIterator](): AsyncIterator<StreamEvent> {
        return {
          next(): Promise<IteratorResult<StreamEvent>> {
            return Promise.resolve(nextResult());
          },
        };
      },
    };
    return handle;
  }

  subscribeHitl(_handler: (req: HitlRequest) => void): { dispose(): void } {
    return { dispose: () => undefined };
  }

  subscribeConnectorConfigChanged(_handler: (ev: ConnectorConfigChanged) => void): {
    dispose(): void;
  } {
    return { dispose: () => undefined };
  }

  subscribeAgentBrief<A extends SupportedAgentName>(
    _agent: A,
    _handler: (ev: AgentBriefEvent<A>) => void,
  ): { dispose(): void } {
    return { dispose: () => {} };
  }

  private brief<A extends SupportedAgentName>(agent: A): Promise<BriefFor<A>> {
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
  agentsWhyPeek(_p: WhyParams): Promise<WhyPeek> {
    if (this.fixtures.whyPeek === undefined) {
      return Promise.reject(new Error("MockClient: no whyPeek fixture configured"));
    }
    return Promise.resolve(this.fixtures.whyPeek);
  }

  getSessionTranscript(_params: { sessionId: string; limit?: number }): Promise<SessionTranscript> {
    return Promise.resolve({ sessionId: "mock-session", turns: [], hasMore: false });
  }

  cancelStream(): Promise<{ ok: boolean }> {
    return Promise.resolve({ ok: true });
  }

  sessionAppend(_params: SessionAppendParams): Promise<{ ok: boolean }> {
    return Promise.resolve({ ok: true });
  }

  sessionRecall(_params: SessionRecallParams): Promise<SessionRecallResult> {
    return Promise.resolve(this.fixtures.sessionRecall ?? { chunks: [] });
  }

  sessionList(): Promise<SessionListResult> {
    return Promise.resolve(this.fixtures.sessionList ?? { sessions: [] });
  }

  sessionClear(_params?: SessionClearParams): Promise<SessionClearResult> {
    return Promise.resolve({ ok: true, cleared: "all" });
  }

  queryItems(_params: QueryItemsParams): Promise<QueryItemsResult> {
    const items = this.fixtures.items ?? [];
    return Promise.resolve({ items, meta: { limit: items.length, total: items.length } });
  }

  searchRanked(_params?: RankedSearchParams): Promise<RankedSearchItem[]> {
    return Promise.resolve(this.fixtures.rankedItems ?? []);
  }

  searchRankedWithRetrieval(_params?: RankedSearchParams): Promise<RankedSearchWithRetrieval> {
    const retrieval =
      this.fixtures.rankedRetrieval === undefined
        ? { vectorRanked: true, reason: null, partial: null, backfill: null }
        : this.fixtures.rankedRetrieval;
    return Promise.resolve({
      items: this.fixtures.rankedItems ?? [],
      retrieval,
      notes: this.fixtures.rankedNotes ?? [],
    });
  }

  querySql(_sql: string): Promise<{ rows: Record<string, unknown>[] }> {
    return Promise.resolve({ rows: this.fixtures.sqlRows ?? [] });
  }

  auditList(_limit?: number): Promise<unknown[]> {
    return Promise.resolve([]);
  }

  auditVerify(_params?: AuditVerifyParams): Promise<AuditVerifyResult> {
    return Promise.resolve(
      this.fixtures.auditVerify ?? { ok: true, verifiedRows: 0, lastVerifiedId: 0 },
    );
  }

  auditGetSummary(): Promise<AuditSummary> {
    return Promise.resolve(
      this.fixtures.auditSummary ?? { byOutcome: {}, byService: {}, total: 0 },
    );
  }

  auditToolCalls(_params?: AuditToolCallsParams): Promise<AuditToolCallsResult> {
    return Promise.resolve(
      this.fixtures.auditToolCalls ?? { toolCalls: [], hasMore: false, nextCursor: null },
    );
  }

  egressHead(): Promise<EgressHead> {
    return Promise.resolve(this.fixtures.egressHead ?? { head: "", count: 0 });
  }

  egressList(_params?: EgressListParams): Promise<EgressListResult> {
    return Promise.resolve({ rows: this.fixtures.egressRows ?? [] });
  }

  egressVerify(): Promise<EgressVerifyResult> {
    return Promise.resolve(this.fixtures.egressVerify ?? { ok: true, verifiedRows: 0 });
  }

  egressProveWindow(_params?: EgressProveWindowParams): Promise<EgressProveWindowResult> {
    return Promise.resolve(
      this.fixtures.egressProveWindow ?? {
        rows: [],
        // All-`"none"` + `indeterminate: true` is the honest default for a
        // fixture-less mock: it has observed nothing, so it claims nothing.
        // Defaulting to "fully covered, zero events" would let a consumer's
        // test pass against a claim no real gateway ever made.
        completeness: {
          coverage: NO_EGRESS_COVERAGE,
          outboundEgressEvents: 0,
          indeterminate: true,
        },
        verify: { ok: true, verifiedRows: 0 },
      },
    );
  }

  consentRespond(_params: ConsentRespondParams): Promise<{ ok: boolean }> {
    return Promise.resolve({ ok: true });
  }

  gatewayPing(_params?: { includeDrift?: boolean }): Promise<GatewayPingResult> {
    return Promise.resolve(
      this.fixtures.gatewayPing ?? {
        version: "mock",
        uptime: 0,
        agentLimits: { maxAgentDepth: 5, maxToolCallsPerSession: 50 },
      },
    );
  }

  diagGetVersion(): Promise<DiagVersion> {
    return Promise.resolve(
      this.fixtures.diagVersion ?? { version: "mock", commit: null, buildId: null, uptimeMs: 0 },
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

  indexMetrics(): Promise<IndexMetrics> {
    return Promise.resolve(this.fixtures.indexMetrics ?? this.defaultIndexMetrics());
  }

  diagSnapshot(): Promise<DiagSnapshot> {
    return Promise.resolve(
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
      },
    );
  }

  adminStatus(): Promise<GatewayStatus> {
    return Promise.resolve(
      this.fixtures.adminStatus ?? {
        policy: { signatureValid: true, pendingRestart: false, source: "none" },
        peers: [],
        connectors: [],
        namespaces: [],
        audit: { chainLength: 0, lastHash: "", appendRate1h: 0 },
        hitl: { pendingApprovals: 0, pendingQuorum: 0 },
        identity: { operatorValid: true },
        syncFreshnessMs: 0,
      },
    );
  }

  metricsDora(_params: MetricsDoraParams): Promise<DoraMetricsResult> {
    return Promise.resolve(
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
      },
    );
  }

  deployPreflight(_params: DeployPreflightParams): Promise<DeployPreflightResult> {
    return Promise.resolve(
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
      },
    );
  }

  connectorListStatus(_params?: { serviceId?: string }): Promise<ConnectorSyncStatus[]> {
    return Promise.resolve(this.fixtures.connectorSyncStatuses ?? []);
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

  connectorStatus(params: ConnectorStatusParams): Promise<ConnectorStatusResult> {
    return Promise.resolve(
      this.fixtures.connectorStatus ?? this.defaultConnectorStatus(params.serviceId),
    );
  }

  connectorHealthHistory(
    _params: ConnectorHealthHistoryParams,
  ): Promise<ConnectorHealthHistoryEntry[]> {
    return Promise.resolve(this.fixtures.connectorHealthHistory ?? []);
  }

  connectorPause(_params: ConnectorServiceParams): Promise<{ ok: boolean }> {
    return Promise.resolve({ ok: true });
  }

  connectorResume(_params: ConnectorServiceParams): Promise<{ ok: boolean }> {
    return Promise.resolve({ ok: true });
  }

  connectorSetInterval(_params: ConnectorSetIntervalParams): Promise<{ ok: boolean }> {
    return Promise.resolve({ ok: true });
  }

  connectorSetConfig(params: ConnectorSetConfigParams): Promise<ConnectorSetConfigResult> {
    return Promise.resolve(
      this.fixtures.connectorSetConfig ?? {
        service: params.serviceId,
        intervalMs: params.intervalMs ?? null,
        depth: params.depth ?? null,
        enabled: params.enabled ?? null,
      },
    );
  }

  connectorSync(_params: ConnectorSyncParams): Promise<{ ok: boolean }> {
    return Promise.resolve({ ok: true });
  }

  connectorAuth(params: ConnectorAuthParams): Promise<ConnectorAuthResult> {
    return Promise.resolve(
      this.fixtures.connectorAuth ?? { ok: true, serviceId: params.serviceId, scopesGranted: [] },
    );
  }

  connectorAddMcp(params: ConnectorAddMcpParams): Promise<ConnectorAddMcpResult> {
    return Promise.resolve(
      this.fixtures.connectorAddMcp ?? { ok: true, serviceId: params.serviceId },
    );
  }

  connectorRemove(_params: ConnectorRemoveParams): Promise<ConnectorRemoveResult> {
    return Promise.resolve(
      this.fixtures.connectorRemove ?? { ok: true, itemsDeleted: 0, vaultKeysRemoved: [] },
    );
  }

  connectorReindex(params: ConnectorReindexParams): Promise<ConnectorReindexResult> {
    return Promise.resolve(
      this.fixtures.connectorReindex ?? {
        itemsAffected: 0,
        depth: params.depth ?? "metadata_only",
        mode: "shallow",
      },
    );
  }

  workflowList(): Promise<WorkflowListResult> {
    return Promise.resolve(this.fixtures.workflowList ?? { workflows: [] });
  }

  workflowSave(_params: WorkflowSaveParams): Promise<{ id: string }> {
    return Promise.resolve({ id: "mock-workflow" });
  }

  workflowDelete(_params: WorkflowDeleteParams): Promise<{ ok: boolean }> {
    return Promise.resolve({ ok: true });
  }

  workflowListRuns(_params: WorkflowListRunsParams): Promise<WorkflowListRunsResult> {
    return Promise.resolve(this.fixtures.workflowListRuns ?? { runs: [] });
  }

  /**
   * The run {@link workflowRun} reports with no fixture, and the same run
   * {@link workflowRunStream} resolves `result` to: the real client answers both
   * from one `workflow.run` RPC, so the double gives both one default. It echoes
   * `dryRun`, and a dry run reports `"preview"` as the Gateway does.
   */
  private defaultWorkflowRun(params: Pick<WorkflowRunParams, "dryRun">): WorkflowRunResult {
    return {
      runId: "mock-run",
      status: params.dryRun === true ? "preview" : "done",
      dryRun: params.dryRun ?? false,
      stepResults: [],
    };
  }

  workflowRun(params: WorkflowRunParams): Promise<WorkflowRunResult> {
    return Promise.resolve(this.fixtures.workflowRun ?? this.defaultWorkflowRun(params));
  }

  workflowCancel(_params: WorkflowCancelParams): Promise<WorkflowCancelResult> {
    return Promise.resolve(this.fixtures.workflowCancel ?? { cancelled: true });
  }

  workflowRunStream(params: WorkflowRunStreamParams): WorkflowRunStreamHandle {
    const chunks = this.fixtures.workflowRunChunks ?? ["mock ", "workflow"];
    const value = this.fixtures.workflowRun ?? this.defaultWorkflowRun(params);
    const cancelResult = this.fixtures.workflowCancel ?? { cancelled: true };
    let i = 0;
    const nextResult = (): IteratorResult<WorkflowRunEvent> => {
      if (i < chunks.length) {
        const text = chunks[i] as string;
        i += 1;
        return { value: { type: "chunk", text }, done: false };
      }
      if (i === chunks.length) {
        i += 1;
        return { value: { type: "done", result: value }, done: false };
      }
      return { value: undefined as unknown as WorkflowRunEvent, done: true };
    };
    return {
      result: Promise.resolve(value),
      streamId: params.streamId ?? "mock-stream",
      cancel(): Promise<WorkflowCancelResult> {
        return Promise.resolve(cancelResult);
      },
      [Symbol.asyncIterator](): AsyncIterator<WorkflowRunEvent> {
        return {
          next(): Promise<IteratorResult<WorkflowRunEvent>> {
            return Promise.resolve(nextResult());
          },
        };
      },
    };
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
