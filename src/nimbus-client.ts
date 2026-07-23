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
  NimbusItem,
  PreflightBrief,
} from "@nimbus-dev/sdk";

import {
  AgentBriefError,
  type AgentBriefEvent,
  type AgentParamsFor,
  AgentTimeoutError,
  type CatchupParams,
  type ConflictsParams,
  DEFAULT_AGENT_TIMEOUT_MS,
  type ExpertParams,
  type GhostParams,
  type HuddleParams,
  type ImpactParams,
  type JanitorParams,
  type PreflightParams,
  parseBriefError,
  parseBriefReady,
} from "./agents.js";
import { createAskStream } from "./ask-stream.js";
import { IPCClient } from "./ipc-transport.js";
import type { AskStreamHandle, AskStreamOptions, HitlRequest } from "./stream-events.js";
import {
  validateAgentInvoke,
  validateAgentSession,
  validateAuditList,
  validateAuditSummary,
  validateAuditToolCalls,
  validateAuditVerify,
  validateDiagSnapshot,
  validateDiagVersion,
  validateEgressHead,
  validateEgressList,
  validateEgressProveWindow,
  validateEgressVerify,
  validateGatewayPing,
  validateGatewayStatus,
  validateIndexMetrics,
  validateOk,
  validateQueryItems,
  validateQuerySql,
  validateRankedItems,
  validateSessionTranscript,
} from "./validate.js";

export type NimbusClientOptions = {
  socketPath: string;
  /**
   * Per-request timeout in milliseconds passed to the transport. A call that
   * receives no response within this window rejects. `0` disables it.
   * Default: 30000.
   */
  requestTimeoutMs?: number;
};

/** Parameters for {@link NimbusClient.searchRanked}. */
export type RankedSearchParams = {
  /** Free-text name/title query. Empty/omitted returns the top-ranked items. */
  name?: string;
  /** Restrict results to a single connector/service id. */
  service?: string;
  /** Restrict results to a single item type (e.g. "file", "email"). */
  itemType?: string;
  /** Max results. The Gateway clamps to 1..500; default 20. */
  limit?: number;
  /** Blend semantic (vector) ranking with keyword search. Defaults to true on the Gateway. */
  semantic?: boolean;
  /** Neighbouring chunks to include per hit. The Gateway clamps to 0..8; default 2. */
  contextChunks?: number;
};

/**
 * An indexed item as `index.queryItems` returns it: a NimbusItem plus the
 * gateway's composite index key (`service:external_id`). `NimbusItem.id` is the
 * bare external id and is not unique across services, so use `indexPrimaryKey`
 * for identity. Mirrors {@link RankedSearchItem}.
 */
export type IndexedItem = NimbusItem & { indexPrimaryKey: string };

/**
 * A ranked index hit: a {@link NimbusItem} enriched with ranking metadata.
 * Mirrors the Gateway's `index.searchRanked` result shape.
 */
export type RankedSearchItem = NimbusItem & {
  score: number;
  indexPrimaryKey: string;
  indexedType: string;
  canonicalUrl?: string;
  duplicates?: readonly string[];
  semanticSnippet?: string;
  bm25Rank?: number | null;
  vectorRank?: number | null;
};

export type SessionTranscript = {
  sessionId: string;
  turns: Array<{
    role: "user" | "assistant";
    text: string;
    timestamp: number;
    auditLogId?: number;
  }>;
  hasMore: boolean;
};

/**
 * A single row of the append-only, BLAKE3-chained egress ledger.
 * Mirrors the Gateway's `EgressRow` shape (`egress/egress-verify.ts`).
 * The ledger records every gated outbound action before it dispatches.
 */
export type EgressRow = {
  id: number;
  timestamp: number;
  sourceType: string;
  sourceId: string | null;
  /** `serviceOf()` prefix of the action type — never a raw URL. */
  destination: string;
  method: string;
  /** Redacted, ≤256-byte debugging summary — NOT a security boundary. */
  payloadSummary: string;
  /** `"approved" | "not_required" | "rejected"`. */
  hitlStatus: string;
  /** `"authorized" | "blocked"`. */
  resultStatus: string;
  rowHash: string;
  prevHash: string;
};

/** Parameters for {@link NimbusClient.egressList}. */
export type EgressListParams = {
  /** Lower bound (inclusive) on row `timestamp`, epoch ms. */
  since?: number;
  /** Upper bound (inclusive) on row `timestamp`, epoch ms. */
  until?: number;
  /** Max rows. The Gateway clamps to 1..5000; default 1000. */
  limit?: number;
};

/** Result of {@link NimbusClient.egressList}. */
export type EgressListResult = {
  rows: EgressRow[];
};

/** Result of {@link NimbusClient.egressHead}: ledger head hash + row count. */
export type EgressHead = {
  head: string;
  count: number;
};

/**
 * Result of {@link NimbusClient.egressVerify}: an offline, timing-safe
 * BLAKE3-chain verification over the whole ledger.
 */
export type EgressVerifyResult = {
  ok: boolean;
  verifiedRows: number;
  /** Row id where the chain first broke, when `ok === false`. */
  brokenAt?: number;
  reason?: string;
};

/** Completeness tier attached to a prove-window result. */
export type EgressCompleteness = {
  tier: "authorized-actions";
  outboundEgressEvents: number;
};

/** An optional signed receipt over a prove-window (Ed25519, share keypair). */
export type EgressReceipt = {
  sigB64: string;
  pubkeyB64: string;
  digest: string;
};

/** Parameters for {@link NimbusClient.egressProveWindow}. */
export type EgressProveWindowParams = {
  /** Lower bound (inclusive) on the window, epoch ms. */
  since?: number;
  /** Upper bound (inclusive) on the window, epoch ms. */
  until?: number;
  /** When true, attach a signed `receipt` over the window digest. */
  sign?: boolean;
};

/** Result of {@link NimbusClient.egressProveWindow}. */
export type EgressProveWindowResult = {
  rows: EgressRow[];
  completeness: EgressCompleteness;
  /** Whole-ledger verify — the window claim is only sound if this is `ok`. */
  verify: EgressVerifyResult;
  receipt?: EgressReceipt;
};

/**
 * Result of {@link NimbusClient.auditVerify}: an audit-chain hash-chain
 * verify pass. Mirrors the Gateway's `AuditVerifyResult` (`db/audit-verify.ts`).
 */
export type AuditVerifyResult = {
  ok: boolean;
  verifiedRows: number;
  lastVerifiedId: number;
  /** Row id where the chain first broke, when `ok === false`. */
  firstBreakAtId?: number;
  reason?: string;
};

/**
 * Parameters for {@link NimbusClient.auditVerify}.
 *
 * When `full` is omitted or `false`, the Gateway verifies only the rows
 * appended since the last verified watermark and, on success, ADVANCES that
 * watermark (`LocalIndex.setAuditVerifiedThroughId`) — so calling this with
 * the defaults has a side effect on the Gateway: a second incremental call
 * right after a successful one verifies zero new rows. Pass `full: true` for
 * an idempotent whole-chain verify.
 */
export type AuditVerifyParams = {
  full?: boolean;
};

/**
 * Audit-log summary counts, as returned by {@link NimbusClient.auditGetSummary}.
 * Mirrors `LocalIndex.getAuditSummary()` (`index/local-index.ts`).
 */
export type AuditSummary = {
  /** Row count by `hitl_status` (e.g. "approved" | "rejected" | "not_required"). */
  byOutcome: Record<string, number>;
  /** Row count by the action-type prefix before its first `.`. */
  byService: Record<string, number>;
  total: number;
};

/**
 * A single logged tool call, as returned by {@link NimbusClient.auditToolCalls}.
 * Mirrors the Gateway's `ToolCallLogReadEntry` (`db/tool-call-log.ts`).
 */
export type ToolCallLogEntry = {
  id: number;
  sessionId: string | null;
  toolId: string;
  service: string;
  calledAt: number;
  durationMs: number;
  resultEnvelope: string;
  status: "ok" | "error";
  /** Redacted params (or the loss-visible `{ truncated: true }` sentinel), or `null`. */
  params: unknown;
};

/** Parameters for {@link NimbusClient.auditToolCalls}. */
export type AuditToolCallsParams = {
  /** Lower bound (inclusive) on `calledAt`, epoch ms. */
  since?: number;
  /** Upper bound (inclusive) on `calledAt`, epoch ms. */
  until?: number;
  /** Max rows. The Gateway clamps to 1..1000; default 100. */
  limit?: number;
  /**
   * Restrict to one session. An empty string (`""`) is a distinct filter
   * meaning "calls with no session" (`session_id IS NULL`), not "unset".
   */
  sessionId?: string;
  toolId?: string;
  status?: "ok" | "error";
  /** Opaque pagination cursor from a previous page's `nextCursor`. */
  cursor?: { calledAt: number; id: number };
};

/** Result of {@link NimbusClient.auditToolCalls}. */
export type AuditToolCallsResult = {
  toolCalls: ToolCallLogEntry[];
  hasMore: boolean;
  nextCursor: { calledAt: number; id: number } | null;
};

/** Parameters for {@link NimbusClient.consentRespond}: the reply to a `HitlRequest`. */
export type ConsentRespondParams = {
  /** The `requestId` from the `HitlRequest` delivered via {@link NimbusClientLike.subscribeHitl}. */
  requestId: string;
  approved: boolean;
};

/**
 * Result of {@link NimbusClient.gatewayPing}. `version`, `uptime`, and
 * `agentLimits` are always present; `drift` is present only when the caller
 * passed `includeDrift: true`. The Gateway also spreads an optional
 * embedding-status object onto the payload, so extra keys beyond this core
 * vary by build — they pass through untyped on this shape.
 */
export type GatewayPingResult = {
  version: string;
  /** Milliseconds since the Gateway process started. */
  uptime: number;
  agentLimits: {
    maxAgentDepth: number;
    maxToolCallsPerSession: number;
  };
  drift?: { lines: string[] };
} & Record<string, unknown>;

/** Result of {@link NimbusClient.diagGetVersion}. */
export type DiagVersion = {
  version: string;
  /** Build commit SHA, or `null` when unset (e.g. a dev build). */
  commit: string | null;
  /** Build id, or `null` when unset. */
  buildId: string | null;
  uptimeMs: number;
};

/** Result of {@link NimbusClient.indexMetrics}; also embedded as `index` in {@link DiagSnapshot}. */
export type IndexMetrics = {
  itemCountByService: Record<string, number>;
  totalItems: number;
  indexSizeBytes: number;
  embeddingCoveragePercent: number;
  /** Epoch ms per connector id, or `null` when the connector has never synced. */
  lastSuccessfulSyncByConnector: Record<string, number | null>;
  queryLatencyP50Ms: number;
  queryLatencyP95Ms: number;
  queryLatencyP99Ms: number;
};

/** One connector's health, as embedded in {@link DiagSnapshot.connectorHealth}. */
export type ConnectorHealthEntry = {
  connectorId: string;
  state: string;
  backoffAttempt: number;
  retryAfterMs?: number;
  backoffUntilMs?: number;
  lastError?: string;
  lastSuccessfulSyncMs?: number;
  lastSyncAttemptMs?: number;
};

/** A watcher summary, as embedded in {@link DiagSnapshot.watchers}. */
export type WatcherSummary = {
  id: string;
  name: string;
  enabled: boolean;
  lastFiredAtMs: number | null;
};

/** Sandbox capability diagnostics, as embedded in {@link DiagSnapshot.sandbox}. */
export type SandboxDiag = {
  platform_capabilities: { network: "per_host" | "all_or_nothing"; reason: string | null };
  linux_helper: { available: boolean; reason: string | null } | null;
  stale_rules_count: number;
};

/** Result of {@link NimbusClient.diagSnapshot}: the aggregated observability view. */
export type DiagSnapshot = {
  gateway: { version: string; uptimeMs: number };
  connectorHealth: ConnectorHealthEntry[];
  index: IndexMetrics;
  hitl: { pendingConsentRequests: number };
  watchers: WatcherSummary[];
  auditLogTail: unknown[];
  extensions: {
    disabled_pre_t2: number;
    signature_disabled_count: number;
    auto_update?: {
      cached_updates_count: number;
      interval_hours: number;
      air_gap_blocked: boolean;
    };
  };
  sandbox: SandboxDiag;
};

/** Where a persisted org policy came from. Mirrors the Gateway's `PolicySource`. */
export type PolicySource = "anchor" | "peer" | "none";

/** Runtime policy status, as embedded in {@link GatewayStatus.policy}. */
export type PolicyState = {
  org?: string;
  version?: number;
  signatureValid: boolean;
  lastFetchedMs?: number;
  pendingRestart: boolean;
  source: PolicySource;
};

/** A federation peer's reachability, as embedded in {@link GatewayStatus.peers}. */
export type PeerStatus = {
  peerId: string;
  reachable: boolean;
  lastSeenMs?: number;
};

/** A connector's status, as embedded in {@link GatewayStatus.connectors}. */
export type ConnectorStatus = {
  id: string;
  enabled: boolean;
  blockedByPolicy: boolean;
  health: string;
  lastSyncMs?: number;
};

/** A namespace's fan-out status, as embedded in {@link GatewayStatus.namespaces}. */
export type NamespaceStatus = {
  name: string;
  subscribers: number;
  lastPropagateMs?: number;
};

/** Audit-chain health, as embedded in {@link GatewayStatus.audit}. */
export type AuditStatus = {
  chainLength: number;
  lastHash: string;
  appendRate1h: number;
};

/** HITL queue depth, as embedded in {@link GatewayStatus.hitl}. */
export type HitlStatusCounts = {
  pendingApprovals: number;
  pendingQuorum: number;
};

/** Identity/SSO status, as embedded in {@link GatewayStatus.identity}. */
export type IdentityStatus = {
  operatorValid: boolean;
  externalId?: string;
};

/**
 * Result of {@link NimbusClient.adminStatus}: the full observability snapshot.
 * Mirrors the Gateway's `GatewayStatus` (`status/types.ts`). Only available
 * when the Gateway was started with `statusReaders` wired — otherwise the
 * call rejects with a JSON-RPC "Method not found" error rather than
 * resolving to this shape.
 */
export type GatewayStatus = {
  policy: PolicyState;
  peers: PeerStatus[];
  connectors: ConnectorStatus[];
  namespaces: NamespaceStatus[];
  audit: AuditStatus;
  hitl: HitlStatusCounts;
  identity: IdentityStatus;
  syncFreshnessMs: number;
};

/**
 * The public surface shared by {@link NimbusClient} and
 * {@link MockClient}. A consumer can type against this so the real client and
 * the in-memory stub stay interchangeable (and in sync at compile time).
 */
export interface NimbusClientLike {
  agentInvoke(
    input: string,
    options?: { stream?: boolean; sessionId?: string; agent?: string },
  ): Promise<{ reply?: string } & Record<string, unknown>>;
  askStream(input: string, opts?: AskStreamOptions): AskStreamHandle;
  subscribeHitl(handler: (req: HitlRequest) => void): { dispose(): void };
  subscribeAgentBrief<A extends AgentName>(
    agent: A,
    handler: (ev: AgentBriefEvent<A>) => void,
  ): { dispose(): void };
  getSessionTranscript(params: { sessionId: string; limit?: number }): Promise<SessionTranscript>;
  cancelStream(streamId: string): Promise<{ ok: boolean }>;
  queryItems(params: {
    services?: string[];
    types?: string[];
    sinceMs?: number;
    untilMs?: number;
    limit?: number;
  }): Promise<{ items: IndexedItem[]; meta: { limit: number; total: number } }>;
  searchRanked(params?: RankedSearchParams): Promise<RankedSearchItem[]>;
  querySql(sql: string): Promise<{ rows: Record<string, unknown>[] }>;
  auditList(limit?: number): Promise<unknown[]>;
  auditVerify(params?: AuditVerifyParams): Promise<AuditVerifyResult>;
  auditGetSummary(): Promise<AuditSummary>;
  auditToolCalls(params?: AuditToolCallsParams): Promise<AuditToolCallsResult>;
  egressHead(): Promise<EgressHead>;
  egressList(params?: EgressListParams): Promise<EgressListResult>;
  egressVerify(): Promise<EgressVerifyResult>;
  egressProveWindow(params?: EgressProveWindowParams): Promise<EgressProveWindowResult>;
  consentRespond(params: ConsentRespondParams): Promise<{ ok: boolean }>;
  gatewayPing(params?: { includeDrift?: boolean }): Promise<GatewayPingResult>;
  diagGetVersion(): Promise<DiagVersion>;
  indexMetrics(): Promise<IndexMetrics>;
  diagSnapshot(): Promise<DiagSnapshot>;
  adminStatus(): Promise<GatewayStatus>;
  agentsExpert(p: ExpertParams, o?: { timeoutMs?: number }): Promise<ExpertBrief>;
  agentsImpact(p: ImpactParams, o?: { timeoutMs?: number }): Promise<ImpactBrief>;
  agentsCatchup(p?: CatchupParams, o?: { timeoutMs?: number }): Promise<CatchupBrief>;
  agentsGhost(p: GhostParams, o?: { timeoutMs?: number }): Promise<GhostBrief>;
  agentsConflicts(p: ConflictsParams, o?: { timeoutMs?: number }): Promise<ConflictBrief>;
  agentsHuddle(p?: HuddleParams, o?: { timeoutMs?: number }): Promise<HuddleBrief>;
  agentsJanitor(p: JanitorParams, o?: { timeoutMs?: number }): Promise<JanitorBrief>;
  agentsPreflight(p: PreflightParams, o?: { timeoutMs?: number }): Promise<PreflightBrief>;
  close(): Promise<void>;
}

/**
 * Typed convenience wrapper over the Gateway JSON-RPC IPC surface.
 */
export class NimbusClient implements NimbusClientLike {
  private readonly ipc: IPCClient;

  private constructor(ipc: IPCClient) {
    this.ipc = ipc;
  }

  static async open(opts: NimbusClientOptions): Promise<NimbusClient> {
    const ipc = new IPCClient(opts.socketPath, {
      ...(opts.requestTimeoutMs === undefined ? {} : { requestTimeoutMs: opts.requestTimeoutMs }),
    });
    await ipc.connect();
    return new NimbusClient(ipc);
  }

  async agentInvoke(
    input: string,
    options?: { stream?: boolean; sessionId?: string; agent?: string },
  ): Promise<{ reply?: string } & Record<string, unknown>> {
    const raw = await this.ipc.call("agent.invoke", {
      input,
      stream: options?.stream ?? false,
      ...(options?.sessionId === undefined ? {} : { sessionId: options.sessionId }),
      ...(options?.agent === undefined ? {} : { agent: options.agent }),
    });
    return validateAgentInvoke("agent.invoke", raw);
  }

  askStream(input: string, opts?: AskStreamOptions): AskStreamHandle {
    return createAskStream(this.ipc, input, opts);
  }

  subscribeHitl(handler: (req: HitlRequest) => void): { dispose(): void } {
    const onBatch = (params: unknown): void => {
      if (typeof params !== "object" || params === null) return;
      const p = params as Record<string, unknown>;
      if (typeof p["requestId"] !== "string" || typeof p["prompt"] !== "string") return;
      const req: HitlRequest =
        typeof p["streamId"] === "string"
          ? {
              requestId: p["requestId"],
              prompt: p["prompt"],
              details: p["details"],
              streamId: p["streamId"],
            }
          : { requestId: p["requestId"], prompt: p["prompt"], details: p["details"] };
      handler(req);
    };
    this.ipc.onNotification("agent.hitlBatch", onBatch);
    return {
      dispose: () => {
        this.ipc.offNotification("agent.hitlBatch", onBatch);
      },
    };
  }

  /**
   * Observe both completion notifications for one agent.
   *
   * Registers on `<agent>.briefReady` AND `<agent>.briefError`; `dispose()`
   * removes both. Generic over the agent NAME so a ninth agent costs one
   * `AGENT_NAMES` entry rather than a new method.
   */
  subscribeAgentBrief<A extends AgentName>(
    agent: A,
    handler: (ev: AgentBriefEvent<A>) => void,
  ): { dispose(): void } {
    const readyMethod = `${agent}.briefReady`;
    const errorMethod = `${agent}.briefError`;
    const onReady = (params: unknown): void => {
      const ev = parseBriefReady(agent, params);
      if (ev !== null) handler(ev);
    };
    const onError = (params: unknown): void => {
      const ev = parseBriefError<A>(params);
      if (ev !== null) handler(ev);
    };
    this.ipc.onNotification(readyMethod, onReady);
    this.ipc.onNotification(errorMethod, onError);
    return {
      dispose: () => {
        this.ipc.offNotification(readyMethod, onReady);
        this.ipc.offNotification(errorMethod, onError);
      },
    };
  }

  /**
   * Fire an agent and await its brief.
   *
   * Ordering matters: the gateway starts the work before the RPC response is
   * parsed (`emit-brief.ts` fires its async IIFE immediately), so we subscribe
   * FIRST and buffer anything that arrives before `sessionId` is known, then
   * drain the buffer. Without the buffer a fast agent's notification is
   * dropped; without the sessionId filter two concurrent runs swap results.
   */
  private async runAgent<A extends AgentName>(
    agent: A,
    params: AgentParamsFor<A>,
    opts?: { timeoutMs?: number },
  ): Promise<BriefFor<A>> {
    const timeoutMs = opts?.timeoutMs ?? DEFAULT_AGENT_TIMEOUT_MS;
    const buffered: AgentBriefEvent<A>[] = [];
    let sessionId: string | null = null;
    let deliver: ((ev: AgentBriefEvent<A>) => void) | null = null;

    const sub = this.subscribeAgentBrief(agent, (ev) => {
      if (sessionId === null) {
        buffered.push(ev);
        return;
      }
      if (ev.sessionId === sessionId) deliver?.(ev);
    });

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const method = `agents.${agent}`;
      const raw = await this.ipc.call<unknown>(method, params);
      const sid = validateAgentSession(method, raw).sessionId;
      sessionId = sid;

      const ev = await new Promise<AgentBriefEvent<A>>((resolve, reject) => {
        deliver = resolve;
        const early = buffered.find((b) => b.sessionId === sid);
        if (early !== undefined) {
          resolve(early);
          return;
        }
        timer = setTimeout(() => {
          reject(new AgentTimeoutError(agent, sid, timeoutMs));
        }, timeoutMs);
      });

      if (!ev.ok) throw new AgentBriefError(agent, ev.sessionId, ev.error);
      return ev.findings;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      sub.dispose();
    }
  }

  agentsExpert(p: ExpertParams, o?: { timeoutMs?: number }): Promise<ExpertBrief> {
    return this.runAgent("expert", p, o);
  }
  agentsImpact(p: ImpactParams, o?: { timeoutMs?: number }): Promise<ImpactBrief> {
    return this.runAgent("impact", p, o);
  }
  agentsCatchup(p?: CatchupParams, o?: { timeoutMs?: number }): Promise<CatchupBrief> {
    return this.runAgent("catchup", p ?? {}, o);
  }
  agentsGhost(p: GhostParams, o?: { timeoutMs?: number }): Promise<GhostBrief> {
    return this.runAgent("ghost", p, o);
  }
  agentsConflicts(p: ConflictsParams, o?: { timeoutMs?: number }): Promise<ConflictBrief> {
    return this.runAgent("conflicts", p, o);
  }
  agentsHuddle(p?: HuddleParams, o?: { timeoutMs?: number }): Promise<HuddleBrief> {
    return this.runAgent("huddle", p ?? {}, o);
  }
  agentsJanitor(p: JanitorParams, o?: { timeoutMs?: number }): Promise<JanitorBrief> {
    return this.runAgent("janitor", p, o);
  }
  agentsPreflight(p: PreflightParams, o?: { timeoutMs?: number }): Promise<PreflightBrief> {
    return this.runAgent("preflight", p, o);
  }

  async getSessionTranscript(params: {
    sessionId: string;
    limit?: number;
  }): Promise<SessionTranscript> {
    const raw = await this.ipc.call("engine.getSessionTranscript", params);
    return validateSessionTranscript("engine.getSessionTranscript", raw);
  }

  async cancelStream(streamId: string): Promise<{ ok: boolean }> {
    const raw = await this.ipc.call("engine.cancelStream", { streamId });
    return validateOk("engine.cancelStream", raw);
  }

  async queryItems(params: {
    services?: string[];
    types?: string[];
    sinceMs?: number;
    untilMs?: number;
    limit?: number;
  }): Promise<{ items: IndexedItem[]; meta: { limit: number; total: number } }> {
    const raw = await this.ipc.call("index.queryItems", {
      services: params.services,
      types: params.types,
      sinceMs: params.sinceMs,
      untilMs: params.untilMs,
      limit: params.limit,
    });
    return validateQueryItems("index.queryItems", raw);
  }

  async searchRanked(params: RankedSearchParams = {}): Promise<RankedSearchItem[]> {
    const raw = await this.ipc.call("index.searchRanked", {
      name: params.name,
      service: params.service,
      itemType: params.itemType,
      limit: params.limit,
      semantic: params.semantic,
      contextChunks: params.contextChunks,
    });
    return validateRankedItems("index.searchRanked", raw);
  }

  async querySql(sql: string): Promise<{ rows: Record<string, unknown>[] }> {
    const raw = await this.ipc.call("index.querySql", { sql });
    return validateQuerySql("index.querySql", raw);
  }

  async auditList(limit?: number): Promise<unknown[]> {
    const raw = await this.ipc.call("audit.list", { limit: limit ?? 50 });
    return validateAuditList("audit.list", raw);
  }

  /**
   * Verify the audit hash chain (read-only response, but see
   * {@link AuditVerifyParams} — the default incremental mode advances a
   * Gateway-side watermark as a side effect of calling it).
   */
  async auditVerify(params: AuditVerifyParams = {}): Promise<AuditVerifyResult> {
    const raw = await this.ipc.call("audit.verify", { full: params.full });
    return validateAuditVerify("audit.verify", raw);
  }

  /** Audit-log summary counts by outcome and by service (read-only). */
  async auditGetSummary(): Promise<AuditSummary> {
    return validateAuditSummary("audit.getSummary", await this.ipc.call("audit.getSummary"));
  }

  /** Paginated, filterable tool-call log (read-only). */
  async auditToolCalls(params: AuditToolCallsParams = {}): Promise<AuditToolCallsResult> {
    const raw = await this.ipc.call("audit.toolCalls", {
      since: params.since,
      until: params.until,
      limit: params.limit,
      sessionId: params.sessionId,
      toolId: params.toolId,
      status: params.status,
      cursor: params.cursor,
    });
    return validateAuditToolCalls("audit.toolCalls", raw);
  }

  /** Egress ledger head hash + row count (read-only). */
  async egressHead(): Promise<EgressHead> {
    return validateEgressHead("egress.head", await this.ipc.call("egress.head"));
  }

  /** List egress-ledger rows, optionally windowed and clamped (read-only). */
  async egressList(params: EgressListParams = {}): Promise<EgressListResult> {
    const raw = await this.ipc.call("egress.list", {
      since: params.since,
      until: params.until,
      limit: params.limit,
    });
    return validateEgressList("egress.list", raw);
  }

  /** Offline, timing-safe verify of the whole egress chain (read-only). */
  async egressVerify(): Promise<EgressVerifyResult> {
    return validateEgressVerify("egress.verify", await this.ipc.call("egress.verify"));
  }

  /**
   * Prove what left the machine in a window: the rows, the completeness tier,
   * a whole-ledger verify, and — when `sign` is set — a signed receipt.
   */
  async egressProveWindow(params: EgressProveWindowParams = {}): Promise<EgressProveWindowResult> {
    const raw = await this.ipc.call("egress.proveWindow", {
      since: params.since,
      until: params.until,
      sign: params.sign,
    });
    return validateEgressProveWindow("egress.proveWindow", raw);
  }

  /**
   * Reply to a pending HITL request delivered via {@link NimbusClient.subscribeHitl}.
   * `requestId` must match the one on the `HitlRequest`; the Gateway rejects
   * unknown, foreign (another client's), or already-answered request ids.
   */
  async consentRespond(params: ConsentRespondParams): Promise<{ ok: boolean }> {
    const raw = await this.ipc.call("consent.respond", {
      requestId: params.requestId,
      approved: params.approved,
    });
    return validateOk("consent.respond", raw);
  }

  /**
   * Liveness + version probe. Pass `includeDrift: true` to also get local-index
   * drift hints. See {@link GatewayPingResult} for which fields are guaranteed.
   */
  async gatewayPing(params: { includeDrift?: boolean } = {}): Promise<GatewayPingResult> {
    const raw = await this.ipc.call("gateway.ping", { includeDrift: params.includeDrift });
    return validateGatewayPing("gateway.ping", raw);
  }

  /** Gateway build identity: version, commit, build id, and uptime. */
  async diagGetVersion(): Promise<DiagVersion> {
    return validateDiagVersion("diag.getVersion", await this.ipc.call("diag.getVersion"));
  }

  /** Index size, per-service item counts, embedding coverage, and query latency percentiles. */
  async indexMetrics(): Promise<IndexMetrics> {
    return validateIndexMetrics("index.metrics", await this.ipc.call("index.metrics"));
  }

  /** Aggregated observability snapshot: connector health, index metrics, HITL/watcher/sandbox state. */
  async diagSnapshot(): Promise<DiagSnapshot> {
    return validateDiagSnapshot("diag.snapshot", await this.ipc.call("diag.snapshot"));
  }

  /**
   * Full policy/peers/connectors/namespaces/audit/hitl/identity snapshot.
   *
   * `admin.status` is only registered when the Gateway was started with
   * `statusReaders` wired (Phase 6 Team builds and later). On a Gateway
   * without it, the call rejects with a plain JSON-RPC "Method not found"
   * error rather than resolving — there is no separate "unsupported" return
   * value, so callers that want to treat this as optional should catch and
   * inspect the rejection.
   */
  async adminStatus(): Promise<GatewayStatus> {
    return validateGatewayStatus("admin.status", await this.ipc.call("admin.status"));
  }

  async close(): Promise<void> {
    await this.ipc.disconnect();
  }
}
