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
  ConnectorHealthEntry,
  ConnectorStatus,
  DiagSnapshot,
  DiagVersion,
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
  IndexedItem,
  IndexMetrics,
  NamespaceStatus,
  PeerStatus,
  PolicyState,
  RankedSearchItem,
  SandboxDiag,
  SessionTranscript,
  WatcherSummary,
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
