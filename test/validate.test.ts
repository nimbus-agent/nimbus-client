import { describe, expect, test } from "bun:test";

import {
  IpcResponseError,
  validateAgentInvoke,
  validateAgentSession,
  validateAuditList,
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
} from "../src/validate.ts";

const INDEX_METRICS = {
  itemCountByService: { github: 1 },
  totalItems: 1,
  indexSizeBytes: 10,
  embeddingCoveragePercent: 100,
  lastSuccessfulSyncByConnector: { github: 1, gmail: null },
  queryLatencyP50Ms: 1,
  queryLatencyP95Ms: 2,
  queryLatencyP99Ms: 3,
};

const DIAG_SNAPSHOT_WIRE = {
  gateway: { version: "0.22.0", uptimeMs: 10 },
  connectorHealth: [{ connectorId: "github", state: "healthy", backoffAttempt: 0 }],
  index: INDEX_METRICS,
  hitl: { pendingConsentRequests: 1 },
  watchers: [{ id: "w1", name: "n", enabled: true, lastFiredAtMs: null }],
  auditLogTail: [{ id: 1 }],
  extensions: { disabled_pre_t2: 0, signature_disabled_count: 0 },
  sandbox: {
    platform_capabilities: { network: "per_host", reason: null },
    linux_helper: { available: true, reason: null },
    stale_rules_count: 0,
  },
};

const GATEWAY_STATUS_WIRE = {
  policy: { signatureValid: true, pendingRestart: false, source: "anchor" },
  peers: [{ peerId: "p1", reachable: true }],
  connectors: [{ id: "c1", enabled: true, blockedByPolicy: false, health: "healthy" }],
  namespaces: [{ name: "ns", subscribers: 1 }],
  audit: { chainLength: 1, lastHash: "h", appendRate1h: 0 },
  hitl: { pendingApprovals: 0, pendingQuorum: 0 },
  identity: { operatorValid: true },
  syncFreshnessMs: 5,
};

const ROW = {
  id: 1,
  timestamp: 1000,
  sourceType: "gmail",
  sourceId: "abc",
  destination: "github",
  method: "POST",
  payloadSummary: "…",
  hitlStatus: "approved",
  resultStatus: "authorized",
  rowHash: "h1",
  prevHash: "h0",
};

describe("validate — happy paths", () => {
  test("validateAgentInvoke accepts a record with/without reply", () => {
    expect(validateAgentInvoke("m", { reply: "hi", extra: 1 })).toEqual({ reply: "hi", extra: 1 });
    expect(validateAgentInvoke("m", {})).toEqual({});
  });

  test("validateOk accepts { ok }", () => {
    expect(validateOk("m", { ok: true })).toEqual({ ok: true });
  });

  test("validateSessionTranscript accepts turns and optional auditLogId", () => {
    const t = validateSessionTranscript("m", {
      sessionId: "s",
      hasMore: false,
      turns: [{ role: "user", text: "hi", timestamp: 1, auditLogId: 9 }],
    });
    expect(t.turns[0]).toEqual({ role: "user", text: "hi", timestamp: 1, auditLogId: 9 });
  });

  test("validateQueryItems accepts a camelCase indexed item", () => {
    expect(
      validateQueryItems("m", {
        items: [{ id: "s1", indexPrimaryKey: "s:s1", service: "s", itemType: "alert", name: "n" }],
        meta: { limit: 1, total: 1 },
      }),
    ).toEqual({
      items: [{ id: "s1", indexPrimaryKey: "s:s1", service: "s", itemType: "alert", name: "n" }],
      meta: { limit: 1, total: 1 },
    });
  });

  test("validateQueryItems rejects a row that is not an indexed item", () => {
    expect(() =>
      validateQueryItems("m", { items: [{ a: 1 }], meta: { limit: 1, total: 1 } }),
    ).toThrow(IpcResponseError);
  });

  test("validateRankedItems accepts rows with the ranking fields", () => {
    const rows = validateRankedItems("m", [
      { id: "x", score: 1, indexPrimaryKey: "pk", indexedType: "file" },
    ]);
    expect(rows).toHaveLength(1);
  });

  test("validateQuerySql / validateAuditList accept arrays", () => {
    expect(validateQuerySql("m", { rows: [{ a: 1 }] })).toEqual({ rows: [{ a: 1 }] });
    expect(validateAuditList("m", [1, 2])).toEqual([1, 2]);
  });

  test("validateEgressHead / List / Verify accept valid shapes", () => {
    expect(validateEgressHead("m", { head: "h", count: 2 })).toEqual({ head: "h", count: 2 });
    expect(validateEgressList("m", { rows: [ROW] }).rows[0]).toMatchObject({ id: 1 });
    expect(
      validateEgressVerify("m", { ok: false, verifiedRows: 3, brokenAt: 2, reason: "x" }),
    ).toEqual({ ok: false, verifiedRows: 3, brokenAt: 2, reason: "x" });
  });

  test("validateEgressProveWindow accepts rows/completeness/verify and optional receipt", () => {
    const out = validateEgressProveWindow("m", {
      rows: [ROW],
      completeness: { tier: "authorized-actions", outboundEgressEvents: 0 },
      verify: { ok: true, verifiedRows: 1 },
      receipt: { sigB64: "s", pubkeyB64: "p", digest: "d" },
    });
    expect(out.receipt).toEqual({ sigB64: "s", pubkeyB64: "p", digest: "d" });
    expect(out.completeness.outboundEgressEvents).toBe(0);
  });

  test("egress row accepts null sourceId", () => {
    const out = validateEgressList("m", { rows: [{ ...ROW, sourceId: null }] });
    expect(out.rows[0]?.sourceId).toBeNull();
  });

  test("validateGatewayPing accepts the core shape, optional drift, and passes extras through", () => {
    const out = validateGatewayPing("m", {
      version: "0.22.0",
      uptime: 100,
      agentLimits: { maxAgentDepth: 6, maxToolCallsPerSession: 40 },
      drift: { lines: ["a"] },
      embeddingModel: "minilm",
    });
    expect(out.version).toBe("0.22.0");
    expect(out.drift).toEqual({ lines: ["a"] });
    expect(out["embeddingModel"]).toBe("minilm");
  });

  test("validateGatewayPing accepts a response with no drift", () => {
    const out = validateGatewayPing("m", {
      version: "0.22.0",
      uptime: 1,
      agentLimits: { maxAgentDepth: 6, maxToolCallsPerSession: 40 },
    });
    expect(out.drift).toBeUndefined();
  });

  test("validateDiagVersion accepts null commit/buildId", () => {
    expect(
      validateDiagVersion("m", { version: "0.22.0", commit: null, buildId: null, uptimeMs: 1 }),
    ).toEqual({ version: "0.22.0", commit: null, buildId: null, uptimeMs: 1 });
  });

  test("validateIndexMetrics accepts the full field list", () => {
    expect(validateIndexMetrics("m", INDEX_METRICS)).toEqual(INDEX_METRICS);
  });

  test("validateDiagSnapshot accepts the full nested shape incl. optional auto_update", () => {
    const withAutoUpdate = {
      ...DIAG_SNAPSHOT_WIRE,
      extensions: {
        disabled_pre_t2: 0,
        signature_disabled_count: 0,
        auto_update: { cached_updates_count: 1, interval_hours: 24, air_gap_blocked: true },
      },
    };
    const out = validateDiagSnapshot("m", withAutoUpdate);
    expect(out.extensions.auto_update).toEqual({
      cached_updates_count: 1,
      interval_hours: 24,
      air_gap_blocked: true,
    });
    expect(out.sandbox.linux_helper).toEqual({ available: true, reason: null });
  });

  test("validateDiagSnapshot accepts a null linux_helper and no auto_update", () => {
    const out = validateDiagSnapshot("m", DIAG_SNAPSHOT_WIRE);
    expect(out.extensions.auto_update).toBeUndefined();
  });

  test("validateGatewayStatus accepts the full snapshot", () => {
    const out = validateGatewayStatus("m", GATEWAY_STATUS_WIRE);
    expect(out.policy.source).toBe("anchor");
    expect(out.peers).toHaveLength(1);
    expect(out.identity).toEqual({ operatorValid: true });
  });
});

describe("validate — rejections throw IpcResponseError", () => {
  test("non-object where object expected", () => {
    expect(() => validateOk("egress.head", 42)).toThrow(IpcResponseError);
    expect(() => validateOk("egress.head", null)).toThrow(/Invalid egress.head/);
    expect(() => validateOk("m", [])).toThrow(/expected an object/);
  });

  test("wrong field types", () => {
    expect(() => validateEgressHead("m", { head: 1, count: 2 })).toThrow(/"head" must be a string/);
    expect(() => validateEgressHead("m", { head: "h", count: "2" })).toThrow(/finite number/);
    expect(() => validateOk("m", { ok: "yes" })).toThrow(/"ok" must be a boolean/);
    expect(() => validateAgentInvoke("m", { reply: 5 })).toThrow(/"reply" must be a string/);
  });

  test("non-array where array expected", () => {
    expect(() => validateAuditList("m", { not: "array" })).toThrow(/expected an array/);
    expect(() => validateQuerySql("m", { rows: "nope" })).toThrow(/expected an array/);
  });

  test("ranked item missing required ranking fields", () => {
    expect(() => validateRankedItems("m", [{ id: "x", score: 1 }])).toThrow(/indexPrimaryKey/);
  });

  test("transcript with an invalid role", () => {
    expect(() =>
      validateSessionTranscript("m", {
        sessionId: "s",
        hasMore: false,
        turns: [{ role: "system", text: "x", timestamp: 1 }],
      }),
    ).toThrow(/"role" must be/);
  });

  test("prove-window with wrong completeness tier", () => {
    expect(() =>
      validateEgressProveWindow("m", {
        rows: [],
        completeness: { tier: "everything", outboundEgressEvents: 0 },
        verify: { ok: true, verifiedRows: 0 },
      }),
    ).toThrow(/"tier" must be/);
  });

  test("egress row with a non-string/non-null sourceId", () => {
    expect(() => validateEgressList("m", { rows: [{ ...ROW, sourceId: 7 }] })).toThrow(
      /"sourceId" must be a string or null/,
    );
  });

  test("validateGatewayPing rejects a missing agentLimits", () => {
    expect(() => validateGatewayPing("m", { version: "v", uptime: 1 })).toThrow(
      /expected an object/,
    );
  });

  test("validateGatewayPing rejects malformed drift lines", () => {
    expect(() =>
      validateGatewayPing("m", {
        version: "v",
        uptime: 1,
        agentLimits: { maxAgentDepth: 1, maxToolCallsPerSession: 1 },
        drift: { lines: [1, 2] },
      }),
    ).toThrow(/drift "lines" must be strings/);
  });

  test("validateDiagVersion rejects a non-string/non-null commit", () => {
    expect(() =>
      validateDiagVersion("m", { version: "v", commit: 7, buildId: null, uptimeMs: 1 }),
    ).toThrow(/"commit" must be a string or null/);
  });

  test("validateIndexMetrics rejects a non-numeric itemCountByService value", () => {
    expect(() =>
      validateIndexMetrics("m", { ...INDEX_METRICS, itemCountByService: { github: "many" } }),
    ).toThrow(/"itemCountByService" values must be numbers/);
  });

  test("validateIndexMetrics rejects a non-number/non-null lastSuccessfulSyncByConnector value", () => {
    expect(() =>
      validateIndexMetrics("m", {
        ...INDEX_METRICS,
        lastSuccessfulSyncByConnector: { github: "never" },
      }),
    ).toThrow(/"lastSuccessfulSyncByConnector" values must be a number or null/);
  });

  test("validateDiagSnapshot rejects an invalid sandbox network value", () => {
    expect(() =>
      validateDiagSnapshot("m", {
        ...DIAG_SNAPSHOT_WIRE,
        sandbox: {
          ...DIAG_SNAPSHOT_WIRE.sandbox,
          platform_capabilities: { network: "bogus", reason: null },
        },
      }),
    ).toThrow(/"network" must be/);
  });

  test("validateGatewayStatus rejects an invalid policy source", () => {
    expect(() =>
      validateGatewayStatus("m", {
        ...GATEWAY_STATUS_WIRE,
        policy: { ...GATEWAY_STATUS_WIRE.policy, source: "bogus" },
      }),
    ).toThrow(/"source" must be "anchor", "peer", or "none"/);
  });
});

describe("validateAgentSession", () => {
  test("accepts a well-formed session envelope", () => {
    expect(validateAgentSession("agents.expert", { sessionId: "expert_1_ab" })).toEqual({
      sessionId: "expert_1_ab",
    });
  });

  test("rejects a missing sessionId", () => {
    expect(() => validateAgentSession("agents.expert", {})).toThrow(IpcResponseError);
  });

  test("rejects a non-object", () => {
    expect(() => validateAgentSession("agents.expert", "nope")).toThrow(IpcResponseError);
  });
});
