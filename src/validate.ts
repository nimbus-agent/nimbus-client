/**
 * Runtime validation for Gateway JSON-RPC results.
 *
 * `IPCClient.call<T>()` asserts the wire payload is `T` without checking it. The
 * public {@link NimbusClient} methods run the raw `unknown` through these guards
 * so a malformed or version-skewed Gateway response fails loudly at the call
 * site (with an {@link IpcResponseError}) instead of silently corrupting typed
 * data downstream. Guards check the required shape and are lenient about extra
 * or optional fields.
 */

import type {
  AuditSummary,
  AuditToolCallsResult,
  AuditVerifyResult,
  CiFinding,
  ConnectorAddMcpResult,
  ConnectorAuthResult,
  ConnectorHealthEntry,
  ConnectorHealthHistoryEntry,
  ConnectorReindexResult,
  ConnectorRemoveResult,
  ConnectorSetConfigResult,
  ConnectorStatus,
  ConnectorStatusResult,
  ConnectorSyncStatus,
  ConnectorSyncTelemetry,
  DeployPreflightResult,
  DiagSnapshot,
  DiagVersion,
  DoraGap,
  DoraMetricsResult,
  DoraMetricValue,
  EgressCompleteness,
  EgressHead,
  EgressListResult,
  EgressProveWindowResult,
  EgressReceipt,
  EgressRow,
  EgressVerifyResult,
  GatewayPingResult,
  GatewayStatus,
  IdentityStatus,
  IncidentFinding,
  IndexedItem,
  IndexMetrics,
  NamespaceStatus,
  PeerStatus,
  PolicyState,
  PreflightCheck,
  PreflightGap,
  PrFinding,
  RankedSearchItem,
  SandboxDiag,
  SessionClearResult,
  SessionListEntry,
  SessionListResult,
  SessionMemoryRole,
  SessionRecallHit,
  SessionRecallResult,
  SessionTranscript,
  ToolCallLogEntry,
  WatcherSummary,
  WorkflowListResult,
  WorkflowListRunsResult,
  WorkflowRow,
  WorkflowRunHistoryRow,
  WorkflowRunResult,
  WorkflowStepResult,
} from "./nimbus-client.js";

/** Thrown when a Gateway response does not match its expected shape. */
export class IpcResponseError extends Error {
  constructor(method: string, detail: string) {
    super(`Invalid ${method} response: ${detail}`);
    this.name = "IpcResponseError";
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function record(method: string, v: unknown): Record<string, unknown> {
  if (!isRecord(v)) throw new IpcResponseError(method, "expected an object");
  return v;
}

function str(method: string, o: Record<string, unknown>, key: string): string {
  const v = o[key];
  if (typeof v !== "string") throw new IpcResponseError(method, `"${key}" must be a string`);
  return v;
}

function num(method: string, o: Record<string, unknown>, key: string): number {
  const v = o[key];
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new IpcResponseError(method, `"${key}" must be a finite number`);
  }
  return v;
}

function bool(method: string, o: Record<string, unknown>, key: string): boolean {
  const v = o[key];
  if (typeof v !== "boolean") throw new IpcResponseError(method, `"${key}" must be a boolean`);
  return v;
}

function arr(method: string, v: unknown): unknown[] {
  if (!Array.isArray(v)) throw new IpcResponseError(method, "expected an array");
  return v;
}

function optStr(o: Record<string, unknown>, key: string): string | undefined {
  const v = o[key];
  return typeof v === "string" ? v : undefined;
}

function optNum(o: Record<string, unknown>, key: string): number | undefined {
  const v = o[key];
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function nullableNum(method: string, o: Record<string, unknown>, key: string): number | null {
  const v = o[key];
  if (v === null) return null;
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new IpcResponseError(method, `"${key}" must be a number or null`);
  }
  return v;
}

function nullableStr(method: string, o: Record<string, unknown>, key: string): string | null {
  const v = o[key];
  if (v === null) return null;
  if (typeof v !== "string") {
    throw new IpcResponseError(method, `"${key}" must be a string or null`);
  }
  return v;
}

function nullableBool(method: string, o: Record<string, unknown>, key: string): boolean | null {
  const v = o[key];
  if (v === null) return null;
  if (typeof v !== "boolean") {
    throw new IpcResponseError(method, `"${key}" must be a boolean or null`);
  }
  return v;
}

/** `{ reply?: string } & Record<string, unknown>` — result of `agent.invoke`. */
export function validateAgentInvoke(
  method: string,
  v: unknown,
): { reply?: string } & Record<string, unknown> {
  const o = record(method, v);
  if (o["reply"] !== undefined && typeof o["reply"] !== "string") {
    throw new IpcResponseError(method, `"reply" must be a string when present`);
  }
  return o as { reply?: string } & Record<string, unknown>;
}

/** `{ ok: boolean }` — result of `engine.cancelStream`. */
export function validateOk(method: string, v: unknown): { ok: boolean } {
  const o = record(method, v);
  return { ok: bool(method, o, "ok") };
}

export function validateSessionTranscript(method: string, v: unknown): SessionTranscript {
  const o = record(method, v);
  const turns = arr(method, o["turns"]).map((t) => {
    const to = record(method, t);
    const role = str(method, to, "role");
    if (role !== "user" && role !== "assistant") {
      throw new IpcResponseError(method, `turn "role" must be "user" or "assistant"`);
    }
    const turn: SessionTranscript["turns"][number] = {
      role,
      text: str(method, to, "text"),
      timestamp: num(method, to, "timestamp"),
    };
    if (to["auditLogId"] !== undefined) turn.auditLogId = num(method, to, "auditLogId");
    return turn;
  });
  return { sessionId: str(method, o, "sessionId"), turns, hasMore: bool(method, o, "hasMore") };
}

function validateSessionMemoryRole(
  method: string,
  o: Record<string, unknown>,
  key: string,
): SessionMemoryRole {
  const v = o[key];
  if (v !== "user" && v !== "assistant" && v !== "tool") {
    throw new IpcResponseError(method, `"${key}" must be "user", "assistant", or "tool"`);
  }
  return v;
}

function validateSessionRecallHit(method: string, v: unknown): SessionRecallHit {
  const o = record(method, v);
  return {
    chunkText: str(method, o, "chunkText"),
    role: validateSessionMemoryRole(method, o, "role"),
    createdAt: num(method, o, "createdAt"),
    distance: num(method, o, "distance"),
  };
}

/** Result of `session.recall`. */
export function validateSessionRecall(method: string, v: unknown): SessionRecallResult {
  const o = record(method, v);
  return { chunks: arr(method, o["chunks"]).map((c) => validateSessionRecallHit(method, c)) };
}

function validateSessionListEntry(method: string, v: unknown): SessionListEntry {
  const o = record(method, v);
  return {
    sessionId: str(method, o, "sessionId"),
    lastWriteAt: num(method, o, "lastWriteAt"),
    chunkCount: num(method, o, "chunkCount"),
  };
}

/** Result of `session.list`. */
export function validateSessionList(method: string, v: unknown): SessionListResult {
  const o = record(method, v);
  return {
    sessions: arr(method, o["sessions"]).map((s) => validateSessionListEntry(method, s)),
  };
}

/** Result of `session.clear`. */
export function validateSessionClear(method: string, v: unknown): SessionClearResult {
  const o = record(method, v);
  return { ok: bool(method, o, "ok"), cleared: str(method, o, "cleared") };
}

/**
 * The gateway maps V3 rows through rowToItem before answering
 * index.queryItems, so the wire is already camelCase NimbusItem plus
 * indexPrimaryKey. This validates that shape — it does NOT translate one.
 * Key translation belongs in the gateway, where the mapping already exists;
 * a second copy here is what drifted last time.
 *
 * `itemType` passes through verbatim: ItemType is an open enum, and rewriting
 * an unrecognised type would be data corruption.
 */
export function validateQueryItems(
  method: string,
  v: unknown,
): { items: IndexedItem[]; meta: { limit: number; total: number } } {
  const o = record(method, v);

  const items = arr(method, o["items"]).map((raw): IndexedItem => {
    const r = record(method, raw);
    const item: IndexedItem = {
      id: str(method, r, "id"),
      indexPrimaryKey: str(method, r, "indexPrimaryKey"),
      service: str(method, r, "service"),
      itemType: str(method, r, "itemType"),
      name: str(method, r, "name"),
    };
    const mimeType = optStr(r, "mimeType");
    if (mimeType !== undefined) item.mimeType = mimeType;
    const sizeBytes = optNum(r, "sizeBytes");
    if (sizeBytes !== undefined) item.sizeBytes = sizeBytes;
    const createdAt = optNum(r, "createdAt");
    if (createdAt !== undefined) item.createdAt = createdAt;
    const modifiedAt = optNum(r, "modifiedAt");
    if (modifiedAt !== undefined) item.modifiedAt = modifiedAt;
    const url = optStr(r, "url");
    if (url !== undefined) item.url = url;
    const parentId = optStr(r, "parentId");
    if (parentId !== undefined) item.parentId = parentId;
    return item;
  });

  const meta = record(method, o["meta"]);
  return { items, meta: { limit: num(method, meta, "limit"), total: num(method, meta, "total") } };
}

export function validateRankedItems(method: string, v: unknown): RankedSearchItem[] {
  return arr(method, v).map((it) => {
    const o = record(method, it);
    // Validate the ranking fields this client adds on top of NimbusItem.
    num(method, o, "score");
    str(method, o, "indexPrimaryKey");
    str(method, o, "indexedType");
    return o as unknown as RankedSearchItem;
  });
}

export function validateQuerySql(method: string, v: unknown): { rows: Record<string, unknown>[] } {
  const o = record(method, v);
  return { rows: arr(method, o["rows"]).map((r) => record(method, r)) };
}

export function validateAuditList(method: string, v: unknown): unknown[] {
  return arr(method, v);
}

/** Result of `audit.verify`. */
export function validateAuditVerify(method: string, v: unknown): AuditVerifyResult {
  const o = record(method, v);
  const result: AuditVerifyResult = {
    ok: bool(method, o, "ok"),
    verifiedRows: num(method, o, "verifiedRows"),
    lastVerifiedId: num(method, o, "lastVerifiedId"),
  };
  if (o["firstBreakAtId"] !== undefined) result.firstBreakAtId = num(method, o, "firstBreakAtId");
  if (o["reason"] !== undefined) result.reason = str(method, o, "reason");
  return result;
}

function validateNumberRecord(method: string, v: unknown, field: string): Record<string, number> {
  const o = record(method, v);
  for (const val of Object.values(o)) {
    if (typeof val !== "number" || !Number.isFinite(val)) {
      throw new IpcResponseError(method, `"${field}" values must be numbers`);
    }
  }
  return o as Record<string, number>;
}

/** Result of `audit.getSummary`. */
export function validateAuditSummary(method: string, v: unknown): AuditSummary {
  const o = record(method, v);
  return {
    byOutcome: validateNumberRecord(method, o["byOutcome"], "byOutcome"),
    byService: validateNumberRecord(method, o["byService"], "byService"),
    total: num(method, o, "total"),
  };
}

function validateToolCallLogEntry(method: string, v: unknown): ToolCallLogEntry {
  const o = record(method, v);
  const sessionId = o["sessionId"];
  if (sessionId !== null && typeof sessionId !== "string") {
    throw new IpcResponseError(method, `tool call "sessionId" must be a string or null`);
  }
  const status = o["status"];
  if (status !== "ok" && status !== "error") {
    throw new IpcResponseError(method, `tool call "status" must be "ok" or "error"`);
  }
  return {
    id: num(method, o, "id"),
    sessionId,
    toolId: str(method, o, "toolId"),
    service: str(method, o, "service"),
    calledAt: num(method, o, "calledAt"),
    durationMs: num(method, o, "durationMs"),
    resultEnvelope: str(method, o, "resultEnvelope"),
    status,
    params: o["params"],
  };
}

function validateToolCallsCursor(
  method: string,
  v: unknown,
): { calledAt: number; id: number } | null {
  if (v === null) return null;
  const o = record(method, v);
  return { calledAt: num(method, o, "calledAt"), id: num(method, o, "id") };
}

/** Result of `audit.toolCalls`. */
export function validateAuditToolCalls(method: string, v: unknown): AuditToolCallsResult {
  const o = record(method, v);
  return {
    toolCalls: arr(method, o["toolCalls"]).map((t) => validateToolCallLogEntry(method, t)),
    hasMore: bool(method, o, "hasMore"),
    nextCursor: validateToolCallsCursor(method, o["nextCursor"]),
  };
}

export function validateEgressHead(method: string, v: unknown): EgressHead {
  const o = record(method, v);
  return { head: str(method, o, "head"), count: num(method, o, "count") };
}

function validateEgressRow(method: string, v: unknown): EgressRow {
  const o = record(method, v);
  const sourceId = o["sourceId"];
  if (sourceId !== null && typeof sourceId !== "string") {
    throw new IpcResponseError(method, `row "sourceId" must be a string or null`);
  }
  return {
    id: num(method, o, "id"),
    timestamp: num(method, o, "timestamp"),
    sourceType: str(method, o, "sourceType"),
    sourceId,
    destination: str(method, o, "destination"),
    method: str(method, o, "method"),
    payloadSummary: str(method, o, "payloadSummary"),
    hitlStatus: str(method, o, "hitlStatus"),
    resultStatus: str(method, o, "resultStatus"),
    rowHash: str(method, o, "rowHash"),
    prevHash: str(method, o, "prevHash"),
  };
}

export function validateEgressList(method: string, v: unknown): EgressListResult {
  const o = record(method, v);
  return { rows: arr(method, o["rows"]).map((r) => validateEgressRow(method, r)) };
}

export function validateEgressVerify(method: string, v: unknown): EgressVerifyResult {
  const o = record(method, v);
  const result: EgressVerifyResult = {
    ok: bool(method, o, "ok"),
    verifiedRows: num(method, o, "verifiedRows"),
  };
  if (o["brokenAt"] !== undefined) result.brokenAt = num(method, o, "brokenAt");
  if (o["reason"] !== undefined) result.reason = str(method, o, "reason");
  return result;
}

function validateEgressCompleteness(method: string, v: unknown): EgressCompleteness {
  const o = record(method, v);
  const tier = str(method, o, "tier");
  if (tier !== "authorized-actions") {
    throw new IpcResponseError(method, `completeness "tier" must be "authorized-actions"`);
  }
  return { tier, outboundEgressEvents: num(method, o, "outboundEgressEvents") };
}

function validateEgressReceipt(method: string, v: unknown): EgressReceipt {
  const o = record(method, v);
  return {
    sigB64: str(method, o, "sigB64"),
    pubkeyB64: str(method, o, "pubkeyB64"),
    digest: str(method, o, "digest"),
  };
}

export function validateEgressProveWindow(method: string, v: unknown): EgressProveWindowResult {
  const o = record(method, v);
  const result: EgressProveWindowResult = {
    rows: arr(method, o["rows"]).map((r) => validateEgressRow(method, r)),
    completeness: validateEgressCompleteness(method, o["completeness"]),
    verify: validateEgressVerify(method, o["verify"]),
  };
  if (o["receipt"] !== undefined) result.receipt = validateEgressReceipt(method, o["receipt"]);
  return result;
}

/** `{ sessionId: string }` — the synchronous return of every `agents.*` method. */
export function validateAgentSession(method: string, v: unknown): { sessionId: string } {
  const o = record(method, v);
  return { sessionId: str(method, o, "sessionId") };
}

/**
 * Result of `gateway.ping`. The Gateway spreads an optional embedding-status
 * object onto the payload, so extra keys beyond the guaranteed core vary by
 * build — this validates the core and passes the rest through untouched.
 */
export function validateGatewayPing(method: string, v: unknown): GatewayPingResult {
  const o = record(method, v);
  str(method, o, "version");
  num(method, o, "uptime");
  const limits = record(method, o["agentLimits"]);
  num(method, limits, "maxAgentDepth");
  num(method, limits, "maxToolCallsPerSession");
  if (o["drift"] !== undefined) {
    const drift = record(method, o["drift"]);
    for (const line of arr(method, drift["lines"])) {
      if (typeof line !== "string") {
        throw new IpcResponseError(method, `drift "lines" must be strings`);
      }
    }
  }
  return o as unknown as GatewayPingResult;
}

/** Result of `diag.getVersion`. */
export function validateDiagVersion(method: string, v: unknown): DiagVersion {
  const o = record(method, v);
  const version = str(method, o, "version");
  const commit = o["commit"];
  if (commit !== null && typeof commit !== "string") {
    throw new IpcResponseError(method, `"commit" must be a string or null`);
  }
  const buildId = o["buildId"];
  if (buildId !== null && typeof buildId !== "string") {
    throw new IpcResponseError(method, `"buildId" must be a string or null`);
  }
  return { version, commit, buildId, uptimeMs: num(method, o, "uptimeMs") };
}

/** Result of `index.metrics` (also embedded as `index` inside `diag.snapshot`). */
export function validateIndexMetrics(method: string, v: unknown): IndexMetrics {
  const o = record(method, v);
  const itemCountByService = record(method, o["itemCountByService"]);
  for (const val of Object.values(itemCountByService)) {
    if (typeof val !== "number" || !Number.isFinite(val)) {
      throw new IpcResponseError(method, `"itemCountByService" values must be numbers`);
    }
  }
  const lastSuccessfulSyncByConnector = record(method, o["lastSuccessfulSyncByConnector"]);
  for (const val of Object.values(lastSuccessfulSyncByConnector)) {
    if (val !== null && (typeof val !== "number" || !Number.isFinite(val))) {
      throw new IpcResponseError(
        method,
        `"lastSuccessfulSyncByConnector" values must be a number or null`,
      );
    }
  }
  return {
    itemCountByService: itemCountByService as Record<string, number>,
    totalItems: num(method, o, "totalItems"),
    indexSizeBytes: num(method, o, "indexSizeBytes"),
    embeddingCoveragePercent: num(method, o, "embeddingCoveragePercent"),
    lastSuccessfulSyncByConnector: lastSuccessfulSyncByConnector as Record<string, number | null>,
    queryLatencyP50Ms: num(method, o, "queryLatencyP50Ms"),
    queryLatencyP95Ms: num(method, o, "queryLatencyP95Ms"),
    queryLatencyP99Ms: num(method, o, "queryLatencyP99Ms"),
  };
}

function validateConnectorHealthEntry(method: string, v: unknown): ConnectorHealthEntry {
  const o = record(method, v);
  const entry: ConnectorHealthEntry = {
    connectorId: str(method, o, "connectorId"),
    state: str(method, o, "state"),
    backoffAttempt: num(method, o, "backoffAttempt"),
  };
  const retryAfterMs = optNum(o, "retryAfterMs");
  if (retryAfterMs !== undefined) entry.retryAfterMs = retryAfterMs;
  const backoffUntilMs = optNum(o, "backoffUntilMs");
  if (backoffUntilMs !== undefined) entry.backoffUntilMs = backoffUntilMs;
  const lastError = optStr(o, "lastError");
  if (lastError !== undefined) entry.lastError = lastError;
  const lastSuccessfulSyncMs = optNum(o, "lastSuccessfulSyncMs");
  if (lastSuccessfulSyncMs !== undefined) entry.lastSuccessfulSyncMs = lastSuccessfulSyncMs;
  const lastSyncAttemptMs = optNum(o, "lastSyncAttemptMs");
  if (lastSyncAttemptMs !== undefined) entry.lastSyncAttemptMs = lastSyncAttemptMs;
  return entry;
}

function validateWatcherSummary(method: string, v: unknown): WatcherSummary {
  const o = record(method, v);
  const lastFiredAtMs = o["lastFiredAtMs"];
  if (
    lastFiredAtMs !== null &&
    (typeof lastFiredAtMs !== "number" || !Number.isFinite(lastFiredAtMs))
  ) {
    throw new IpcResponseError(method, `"lastFiredAtMs" must be a number or null`);
  }
  return {
    id: str(method, o, "id"),
    name: str(method, o, "name"),
    enabled: bool(method, o, "enabled"),
    lastFiredAtMs,
  };
}

function validateSandboxDiag(method: string, v: unknown): SandboxDiag {
  const o = record(method, v);
  const caps = record(method, o["platform_capabilities"]);
  const network = caps["network"];
  if (network !== "per_host" && network !== "all_or_nothing") {
    throw new IpcResponseError(
      method,
      `platform_capabilities "network" must be "per_host" or "all_or_nothing"`,
    );
  }
  const capsReason = caps["reason"];
  if (capsReason !== null && typeof capsReason !== "string") {
    throw new IpcResponseError(method, `platform_capabilities "reason" must be a string or null`);
  }
  const linuxHelperRaw = o["linux_helper"];
  let linuxHelper: SandboxDiag["linux_helper"] = null;
  if (linuxHelperRaw !== null) {
    const lh = record(method, linuxHelperRaw);
    const lhReason = lh["reason"];
    if (lhReason !== null && typeof lhReason !== "string") {
      throw new IpcResponseError(method, `linux_helper "reason" must be a string or null`);
    }
    linuxHelper = { available: bool(method, lh, "available"), reason: lhReason };
  }
  return {
    platform_capabilities: { network, reason: capsReason },
    linux_helper: linuxHelper,
    stale_rules_count: num(method, o, "stale_rules_count"),
  };
}

/** Result of `diag.snapshot`: the aggregated health/metrics/audit/watchers/HITL/sandbox view. */
export function validateDiagSnapshot(method: string, v: unknown): DiagSnapshot {
  const o = record(method, v);
  const gateway = record(method, o["gateway"]);
  const hitl = record(method, o["hitl"]);
  const extensionsRaw = record(method, o["extensions"]);
  const extensions: DiagSnapshot["extensions"] = {
    disabled_pre_t2: num(method, extensionsRaw, "disabled_pre_t2"),
    signature_disabled_count: num(method, extensionsRaw, "signature_disabled_count"),
  };
  if (extensionsRaw["auto_update"] !== undefined) {
    const au = record(method, extensionsRaw["auto_update"]);
    extensions.auto_update = {
      cached_updates_count: num(method, au, "cached_updates_count"),
      interval_hours: num(method, au, "interval_hours"),
      air_gap_blocked: bool(method, au, "air_gap_blocked"),
    };
  }
  return {
    gateway: {
      version: str(method, gateway, "version"),
      uptimeMs: num(method, gateway, "uptimeMs"),
    },
    connectorHealth: arr(method, o["connectorHealth"]).map((h) =>
      validateConnectorHealthEntry(method, h),
    ),
    index: validateIndexMetrics(method, o["index"]),
    hitl: { pendingConsentRequests: num(method, hitl, "pendingConsentRequests") },
    watchers: arr(method, o["watchers"]).map((w) => validateWatcherSummary(method, w)),
    auditLogTail: arr(method, o["auditLogTail"]),
    extensions,
    sandbox: validateSandboxDiag(method, o["sandbox"]),
  };
}

function validatePolicyState(method: string, v: unknown): PolicyState {
  const o = record(method, v);
  const source = o["source"];
  if (source !== "anchor" && source !== "peer" && source !== "none") {
    throw new IpcResponseError(method, `policy "source" must be "anchor", "peer", or "none"`);
  }
  const state: PolicyState = {
    signatureValid: bool(method, o, "signatureValid"),
    pendingRestart: bool(method, o, "pendingRestart"),
    source,
  };
  const org = optStr(o, "org");
  if (org !== undefined) state.org = org;
  const version = optNum(o, "version");
  if (version !== undefined) state.version = version;
  const lastFetchedMs = optNum(o, "lastFetchedMs");
  if (lastFetchedMs !== undefined) state.lastFetchedMs = lastFetchedMs;
  return state;
}

function validatePeerStatus(method: string, v: unknown): PeerStatus {
  const o = record(method, v);
  const status: PeerStatus = {
    peerId: str(method, o, "peerId"),
    reachable: bool(method, o, "reachable"),
  };
  const lastSeenMs = optNum(o, "lastSeenMs");
  if (lastSeenMs !== undefined) status.lastSeenMs = lastSeenMs;
  return status;
}

function validateConnectorStatus(method: string, v: unknown): ConnectorStatus {
  const o = record(method, v);
  const status: ConnectorStatus = {
    id: str(method, o, "id"),
    enabled: bool(method, o, "enabled"),
    blockedByPolicy: bool(method, o, "blockedByPolicy"),
    health: str(method, o, "health"),
  };
  const lastSyncMs = optNum(o, "lastSyncMs");
  if (lastSyncMs !== undefined) status.lastSyncMs = lastSyncMs;
  return status;
}

function validateNamespaceStatus(method: string, v: unknown): NamespaceStatus {
  const o = record(method, v);
  const status: NamespaceStatus = {
    name: str(method, o, "name"),
    subscribers: num(method, o, "subscribers"),
  };
  const lastPropagateMs = optNum(o, "lastPropagateMs");
  if (lastPropagateMs !== undefined) status.lastPropagateMs = lastPropagateMs;
  return status;
}

/**
 * Result of `admin.status`. Only meaningful when the call succeeds — the
 * Gateway answers a plain JSON-RPC "Method not found" when it was started
 * without `statusReaders` wired, which surfaces as a rejected promise from
 * `IPCClient.call`, never as a validated-but-empty result.
 */
export function validateGatewayStatus(method: string, v: unknown): GatewayStatus {
  const o = record(method, v);
  const audit = record(method, o["audit"]);
  const hitl = record(method, o["hitl"]);
  const identity = record(method, o["identity"]);
  const identityStatus: IdentityStatus = { operatorValid: bool(method, identity, "operatorValid") };
  const externalId = optStr(identity, "externalId");
  if (externalId !== undefined) identityStatus.externalId = externalId;
  return {
    policy: validatePolicyState(method, o["policy"]),
    peers: arr(method, o["peers"]).map((p) => validatePeerStatus(method, p)),
    connectors: arr(method, o["connectors"]).map((c) => validateConnectorStatus(method, c)),
    namespaces: arr(method, o["namespaces"]).map((n) => validateNamespaceStatus(method, n)),
    audit: {
      chainLength: num(method, audit, "chainLength"),
      lastHash: str(method, audit, "lastHash"),
      appendRate1h: num(method, audit, "appendRate1h"),
    },
    hitl: {
      pendingApprovals: num(method, hitl, "pendingApprovals"),
      pendingQuorum: num(method, hitl, "pendingQuorum"),
    },
    identity: identityStatus,
    syncFreshnessMs: num(method, o, "syncFreshnessMs"),
  };
}

const DORA_GAP_VALUES = new Set<string>([
  "no_pagerduty_mapping",
  "no_repos",
  "no_deployment_data",
  "low_sample",
  "approximate_lead_time",
  "mixed_source",
]);

function validateDoraGap(method: string, v: unknown, field: string): DoraGap {
  if (v === null) return null;
  if (typeof v === "string" && DORA_GAP_VALUES.has(v)) return v as DoraGap;
  throw new IpcResponseError(method, `"${field}" must be a recognised DORA gap code or null`);
}

function validateDoraMetricValue(method: string, v: unknown, field: string): DoraMetricValue {
  const o = record(method, v);
  const value = o["value"];
  if (value !== null && (typeof value !== "number" || !Number.isFinite(value))) {
    throw new IpcResponseError(method, `"${field}.value" must be a number or null`);
  }
  return {
    value,
    unit: str(method, o, "unit"),
    sample: num(method, o, "sample"),
    gap: validateDoraGap(method, o["gap"], `${field}.gap`),
  };
}

/**
 * Result of `metrics.dora`. A `value: null` metric (no deployment data, an
 * unconfigured service, etc.) is a valid, expected response — not rejected.
 */
export function validateDoraMetrics(method: string, v: unknown): DoraMetricsResult {
  const o = record(method, v);
  const metrics = record(method, o["metrics"]);
  return {
    service: str(method, o, "service"),
    since_ms: num(method, o, "since_ms"),
    computed_at: str(method, o, "computed_at"),
    metrics: {
      deployment_frequency: validateDoraMetricValue(
        method,
        metrics["deployment_frequency"],
        "deployment_frequency",
      ),
      lead_time_for_changes: validateDoraMetricValue(
        method,
        metrics["lead_time_for_changes"],
        "lead_time_for_changes",
      ),
      change_failure_rate: validateDoraMetricValue(
        method,
        metrics["change_failure_rate"],
        "change_failure_rate",
      ),
      mttr: validateDoraMetricValue(method, metrics["mttr"], "mttr"),
    },
  };
}

const PREFLIGHT_GAP_VALUES = new Set<string>([
  "no_pagerduty_mapping",
  "no_repos",
  "unknown_mergeable_state",
  "pagerduty_urgency_without_priority",
]);

function validatePreflightGap(method: string, v: unknown, field: string): PreflightGap {
  if (v === null) return null;
  if (typeof v === "string" && PREFLIGHT_GAP_VALUES.has(v)) return v as PreflightGap;
  throw new IpcResponseError(method, `"${field}" must be a recognised preflight gap code or null`);
}

function optUrl(method: string, o: Record<string, unknown>, field: string): string | null {
  const url = o["url"];
  if (url !== null && typeof url !== "string") {
    throw new IpcResponseError(method, `${field} "url" must be a string or null`);
  }
  return url;
}

function validateIncidentFinding(method: string, v: unknown): IncidentFinding {
  const o = record(method, v);
  const status = o["status"];
  if (status !== "triggered" && status !== "acknowledged") {
    throw new IpcResponseError(
      method,
      `incident finding "status" must be "triggered" or "acknowledged"`,
    );
  }
  return {
    id: str(method, o, "id"),
    title: str(method, o, "title"),
    status,
    severity: str(method, o, "severity"),
    opened_at_ms: num(method, o, "opened_at_ms"),
    pagerduty_service_id: str(method, o, "pagerduty_service_id"),
    url: optUrl(method, o, "incident finding"),
  };
}

function validateCiFinding(method: string, v: unknown): CiFinding {
  const o = record(method, v);
  const conclusion = o["conclusion"];
  if (conclusion !== "failure" && conclusion !== "cancelled" && conclusion !== "timed_out") {
    throw new IpcResponseError(
      method,
      `ci finding "conclusion" must be "failure", "cancelled", or "timed_out"`,
    );
  }
  const headSha = o["head_sha"];
  if (headSha !== null && typeof headSha !== "string") {
    throw new IpcResponseError(method, `ci finding "head_sha" must be a string or null`);
  }
  return {
    id: str(method, o, "id"),
    title: str(method, o, "title"),
    conclusion,
    modified_at_ms: num(method, o, "modified_at_ms"),
    branch: str(method, o, "branch"),
    head_sha: headSha,
    url: optUrl(method, o, "ci finding"),
  };
}

function validatePrFinding(method: string, v: unknown): PrFinding {
  const o = record(method, v);
  return {
    id: str(method, o, "id"),
    title: str(method, o, "title"),
    number: num(method, o, "number"),
    mergeable_state: str(method, o, "mergeable_state"),
    modified_at_ms: num(method, o, "modified_at_ms"),
    url: optUrl(method, o, "pr finding"),
  };
}

function validatePreflightCheck<F>(
  method: string,
  v: unknown,
  field: string,
  validateFinding: (method: string, v: unknown) => F,
): PreflightCheck<F> {
  const o = record(method, v);
  return {
    count: num(method, o, "count"),
    findings: arr(method, o["findings"]).map((f) => validateFinding(method, f)),
    gap: validatePreflightGap(method, o["gap"], `${field}.gap`),
  };
}

/**
 * Result of `deploy.preflight`. An unconfigured service still resolves
 * successfully (`verdict: "ok"`, every check at `count: 0` with a gap code)
 * rather than the call rejecting.
 */
export function validateDeployPreflight(method: string, v: unknown): DeployPreflightResult {
  const o = record(method, v);
  const verdict = o["verdict"];
  if (verdict !== "ok" && verdict !== "warn") {
    throw new IpcResponseError(method, `"verdict" must be "ok" or "warn"`);
  }
  const checks = record(method, o["checks"]);
  return {
    service: str(method, o, "service"),
    target_ref: str(method, o, "target_ref"),
    computed_at: str(method, o, "computed_at"),
    verdict,
    checks: {
      active_p1_incidents: validatePreflightCheck(
        method,
        checks["active_p1_incidents"],
        "active_p1_incidents",
        validateIncidentFinding,
      ),
      failing_ci_runs: validatePreflightCheck(
        method,
        checks["failing_ci_runs"],
        "failing_ci_runs",
        validateCiFinding,
      ),
      merge_conflicts: validatePreflightCheck(
        method,
        checks["merge_conflicts"],
        "merge_conflicts",
        validatePrFinding,
      ),
    },
  };
}

const CONNECTOR_STATUS_VALUES = new Set<string>(["ok", "syncing", "paused", "backoff", "error"]);

const CONNECTOR_DEPTH_VALUES = new Set<string>(["metadata_only", "summary", "full"]);

/** A single `connector.listStatus` / `connector.status` row. Mirrors the Gateway's `SyncStatus`. */
export function validateConnectorSyncStatus(method: string, v: unknown): ConnectorSyncStatus {
  const o = record(method, v);
  const status = o["status"];
  if (typeof status !== "string" || !CONNECTOR_STATUS_VALUES.has(status)) {
    throw new IpcResponseError(method, `"status" must be a recognised connector status`);
  }
  const depth = o["depth"];
  if (typeof depth !== "string" || !CONNECTOR_DEPTH_VALUES.has(depth)) {
    throw new IpcResponseError(method, `"depth" must be "metadata_only", "summary", or "full"`);
  }
  const result: ConnectorSyncStatus = {
    serviceId: str(method, o, "serviceId"),
    status: status as ConnectorSyncStatus["status"],
    lastSyncAt: nullableNum(method, o, "lastSyncAt"),
    nextSyncAt: nullableNum(method, o, "nextSyncAt"),
    intervalMs: num(method, o, "intervalMs"),
    itemCount: num(method, o, "itemCount"),
    lastError: nullableStr(method, o, "lastError"),
    consecutiveFailures: num(method, o, "consecutiveFailures"),
    depth: depth as ConnectorSyncStatus["depth"],
    enabled: bool(method, o, "enabled"),
  };
  const healthState = optStr(o, "healthState");
  if (healthState !== undefined) result.healthState = healthState;
  if (o["healthRetryAfterMs"] !== undefined) {
    result.healthRetryAfterMs = nullableNum(method, o, "healthRetryAfterMs");
  }
  return result;
}

/** Result of `connector.listStatus`. */
export function validateConnectorSyncStatusList(method: string, v: unknown): ConnectorSyncStatus[] {
  return arr(method, v).map((r) => validateConnectorSyncStatus(method, r));
}

function validateConnectorSyncTelemetry(method: string, v: unknown): ConnectorSyncTelemetry {
  const o = record(method, v);
  return {
    startedAt: num(method, o, "startedAt"),
    durationMs: num(method, o, "durationMs"),
    itemsUpserted: num(method, o, "itemsUpserted"),
    itemsDeleted: num(method, o, "itemsDeleted"),
    bytesTransferred: nullableNum(method, o, "bytesTransferred"),
    hadMore: bool(method, o, "hadMore"),
    errorMsg: nullableStr(method, o, "errorMsg"),
  };
}

/** Result of `connector.status`. `telemetry` is present only when `includeStats: true` was passed. */
export function validateConnectorStatusResult(method: string, v: unknown): ConnectorStatusResult {
  const base = validateConnectorSyncStatus(method, v);
  const o = record(method, v);
  if (o["telemetry"] === undefined) return base;
  return {
    ...base,
    telemetry: arr(method, o["telemetry"]).map((t) => validateConnectorSyncTelemetry(method, t)),
  };
}

function validateConnectorHealthHistoryEntry(
  method: string,
  v: unknown,
): ConnectorHealthHistoryEntry {
  const o = record(method, v);
  return {
    id: num(method, o, "id"),
    connectorId: str(method, o, "connectorId"),
    fromState: nullableStr(method, o, "fromState"),
    toState: str(method, o, "toState"),
    reason: nullableStr(method, o, "reason"),
    occurredAtMs: num(method, o, "occurredAtMs"),
  };
}

/** Result of `connector.healthHistory`. */
export function validateConnectorHealthHistory(
  method: string,
  v: unknown,
): ConnectorHealthHistoryEntry[] {
  return arr(method, v).map((r) => validateConnectorHealthHistoryEntry(method, r));
}

/** Result of `connector.setConfig`. */
export function validateConnectorSetConfig(method: string, v: unknown): ConnectorSetConfigResult {
  const o = record(method, v);
  return {
    service: str(method, o, "service"),
    intervalMs: nullableNum(method, o, "intervalMs"),
    depth: nullableStr(method, o, "depth"),
    enabled: nullableBool(method, o, "enabled"),
  };
}

/** Result of `connector.reindex`. */
export function validateConnectorReindex(method: string, v: unknown): ConnectorReindexResult {
  const o = record(method, v);
  const depth = o["depth"];
  if (typeof depth !== "string" || !CONNECTOR_DEPTH_VALUES.has(depth)) {
    throw new IpcResponseError(method, `"depth" must be "metadata_only", "summary", or "full"`);
  }
  const mode = o["mode"];
  if (mode !== "shallow" && mode !== "deepen") {
    throw new IpcResponseError(method, `"mode" must be "shallow" or "deepen"`);
  }
  return {
    itemsAffected: num(method, o, "itemsAffected"),
    depth: depth as ConnectorReindexResult["depth"],
    mode,
  };
}

/** Result of `connector.auth`: identical across every provider. */
export function validateConnectorAuth(method: string, v: unknown): ConnectorAuthResult {
  const o = record(method, v);
  if (!bool(method, o, "ok")) {
    throw new IpcResponseError(method, `"ok" must be true`);
  }
  const scopesGranted = arr(method, o["scopesGranted"]).map((s) => {
    if (typeof s !== "string") {
      throw new IpcResponseError(method, `"scopesGranted" must contain only strings`);
    }
    return s;
  });
  return { ok: true, serviceId: str(method, o, "serviceId"), scopesGranted };
}

/**
 * A HITL-gated `connector.*` result: either the denied/disconnected shape
 * (`{ status: "rejected", reason }`) or the caller-supplied success shape.
 */
function validateGatedOrElse<T>(
  method: string,
  v: unknown,
  validateSuccess: (method: string, o: Record<string, unknown>) => T,
): T | { status: "rejected"; reason: string } {
  const o = record(method, v);
  if (o["status"] === "rejected") {
    return { status: "rejected", reason: str(method, o, "reason") };
  }
  return validateSuccess(method, o);
}

/** Result of `connector.addMcp`. See {@link ConnectorAddMcpResult} for the dual-shape contract. */
export function validateConnectorAddMcp(method: string, v: unknown): ConnectorAddMcpResult {
  return validateGatedOrElse(method, v, (m, o) => {
    if (!bool(m, o, "ok")) {
      throw new IpcResponseError(m, `"ok" must be true`);
    }
    return { ok: true as const, serviceId: str(m, o, "serviceId") };
  });
}

/** Result of `connector.remove`. See {@link ConnectorRemoveResult} for the dual-shape contract. */
export function validateConnectorRemove(method: string, v: unknown): ConnectorRemoveResult {
  return validateGatedOrElse(method, v, (m, o) => {
    if (!bool(m, o, "ok")) {
      throw new IpcResponseError(m, `"ok" must be true`);
    }
    const vaultKeysRemoved = arr(m, o["vaultKeysRemoved"]).map((k) => {
      if (typeof k !== "string") {
        throw new IpcResponseError(m, `"vaultKeysRemoved" must contain only strings`);
      }
      return k;
    });
    return { ok: true as const, itemsDeleted: num(m, o, "itemsDeleted"), vaultKeysRemoved };
  });
}

function validateWorkflowRow(method: string, v: unknown): WorkflowRow {
  const o = record(method, v);
  return {
    id: str(method, o, "id"),
    name: str(method, o, "name"),
    description: nullableStr(method, o, "description"),
    steps_json: str(method, o, "steps_json"),
    created_at: num(method, o, "created_at"),
    updated_at: num(method, o, "updated_at"),
  };
}

/** Result of `workflow.list`. */
export function validateWorkflowList(method: string, v: unknown): WorkflowListResult {
  const o = record(method, v);
  return { workflows: arr(method, o["workflows"]).map((w) => validateWorkflowRow(method, w)) };
}

/** Result of `workflow.save`. */
export function validateWorkflowSave(method: string, v: unknown): { id: string } {
  const o = record(method, v);
  return { id: str(method, o, "id") };
}

function validateWorkflowRunHistoryRow(method: string, v: unknown): WorkflowRunHistoryRow {
  const o = record(method, v);
  return {
    id: str(method, o, "id"),
    startedAt: num(method, o, "startedAt"),
    finishedAt: nullableNum(method, o, "finishedAt"),
    durationMs: nullableNum(method, o, "durationMs"),
    status: str(method, o, "status"),
    errorMsg: nullableStr(method, o, "errorMsg"),
    dryRun: bool(method, o, "dryRun"),
    paramsOverrideJson: nullableStr(method, o, "paramsOverrideJson"),
    triggeredBy: str(method, o, "triggeredBy"),
  };
}

/** Result of `workflow.listRuns`. */
export function validateWorkflowListRuns(method: string, v: unknown): WorkflowListRunsResult {
  const o = record(method, v);
  return { runs: arr(method, o["runs"]).map((r) => validateWorkflowRunHistoryRow(method, r)) };
}

function validateWorkflowStepResult(method: string, v: unknown): WorkflowStepResult {
  const o = record(method, v);
  const result: WorkflowStepResult = { status: str(method, o, "status") };
  const label = optStr(o, "label");
  if (label !== undefined) result.label = label;
  const output = optStr(o, "output");
  if (output !== undefined) result.output = output;
  const error = optStr(o, "error");
  if (error !== undefined) result.error = error;
  return result;
}

/** Result of `workflow.run`. */
export function validateWorkflowRun(method: string, v: unknown): WorkflowRunResult {
  const o = record(method, v);
  return {
    runId: str(method, o, "runId"),
    dryRun: bool(method, o, "dryRun"),
    stepResults: arr(method, o["stepResults"]).map((s) => validateWorkflowStepResult(method, s)),
  };
}
