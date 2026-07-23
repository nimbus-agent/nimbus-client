import { describe, expect, test } from "bun:test";

import {
  IpcResponseError,
  validateAgentInvoke,
  validateAgentSession,
  validateAuditList,
  validateAuditSummary,
  validateAuditToolCalls,
  validateAuditVerify,
  validateConnectorAddMcp,
  validateConnectorAuth,
  validateConnectorHealthHistory,
  validateConnectorReindex,
  validateConnectorRemove,
  validateConnectorSetConfig,
  validateConnectorStatusResult,
  validateConnectorSyncStatusList,
  validateDeployPreflight,
  validateDiagSnapshot,
  validateDiagVersion,
  validateDoraMetrics,
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
  validateSessionClear,
  validateSessionList,
  validateSessionRecall,
  validateSessionTranscript,
  validateWorkflowList,
  validateWorkflowListRuns,
  validateWorkflowRun,
  validateWorkflowSave,
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

const DORA_METRIC_VALUE = { value: 1, unit: "deploys_per_day", sample: 10, gap: null };

const DORA_WIRE = {
  service: "checkout",
  since_ms: 2_592_000_000,
  computed_at: "2026-07-22T00:00:00.000Z",
  metrics: {
    deployment_frequency: DORA_METRIC_VALUE,
    lead_time_for_changes: { value: 3600, unit: "seconds_median", sample: 10, gap: null },
    change_failure_rate: { value: 0.1, unit: "ratio", sample: 10, gap: "low_sample" },
    mttr: { value: null, unit: "seconds_median", sample: 0, gap: "no_pagerduty_mapping" },
  },
};

const PREFLIGHT_WIRE = {
  service: "checkout",
  target_ref: "main",
  computed_at: "2026-07-22T00:00:00.000Z",
  verdict: "ok" as const,
  checks: {
    active_p1_incidents: { count: 0, findings: [], gap: null },
    failing_ci_runs: { count: 0, findings: [], gap: null },
    merge_conflicts: { count: 0, findings: [], gap: null },
  },
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

  test("validateAuditVerify accepts a clean pass and a broken-chain result", () => {
    expect(validateAuditVerify("m", { ok: true, verifiedRows: 5, lastVerifiedId: 5 })).toEqual({
      ok: true,
      verifiedRows: 5,
      lastVerifiedId: 5,
    });
    expect(
      validateAuditVerify("m", {
        ok: false,
        verifiedRows: 2,
        lastVerifiedId: 2,
        firstBreakAtId: 3,
        reason: "row_hash mismatch at id 3",
      }),
    ).toEqual({
      ok: false,
      verifiedRows: 2,
      lastVerifiedId: 2,
      firstBreakAtId: 3,
      reason: "row_hash mismatch at id 3",
    });
  });

  test("validateAuditSummary accepts count records, including empty ones", () => {
    expect(
      validateAuditSummary("m", {
        byOutcome: { approved: 3, rejected: 1 },
        byService: { github: 4 },
        total: 4,
      }),
    ).toEqual({ byOutcome: { approved: 3, rejected: 1 }, byService: { github: 4 }, total: 4 });
    expect(validateAuditSummary("m", { byOutcome: {}, byService: {}, total: 0 })).toEqual({
      byOutcome: {},
      byService: {},
      total: 0,
    });
  });

  test("validateAuditToolCalls accepts a page with a null sessionId, params, and cursor", () => {
    const out = validateAuditToolCalls("m", {
      toolCalls: [
        {
          id: 1,
          sessionId: null,
          toolId: "github.issue.create",
          service: "github",
          calledAt: 100,
          durationMs: 5,
          resultEnvelope: "{}",
          status: "ok",
          params: { a: 1 },
        },
      ],
      hasMore: true,
      nextCursor: { calledAt: 100, id: 1 },
    });
    expect(out.toolCalls[0]?.sessionId).toBeNull();
    expect(out.toolCalls[0]?.params).toEqual({ a: 1 });
    expect(out.hasMore).toBe(true);
    expect(out.nextCursor).toEqual({ calledAt: 100, id: 1 });
  });

  test("validateAuditToolCalls accepts a null nextCursor", () => {
    const out = validateAuditToolCalls("m", { toolCalls: [], hasMore: false, nextCursor: null });
    expect(out.nextCursor).toBeNull();
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

  test("validateSessionRecall accepts chunks with each memory role", () => {
    const out = validateSessionRecall("session.recall", {
      chunks: [
        { chunkText: "a", role: "user", createdAt: 1, distance: 0.1 },
        { chunkText: "b", role: "assistant", createdAt: 2, distance: 0.2 },
        { chunkText: "c", role: "tool", createdAt: 3, distance: 0.3 },
      ],
    });
    expect(out.chunks).toHaveLength(3);
    expect(out.chunks[2]?.role).toBe("tool");
  });

  test("validateSessionRecall accepts an empty chunks array", () => {
    expect(validateSessionRecall("session.recall", { chunks: [] })).toEqual({ chunks: [] });
  });

  test("validateSessionList accepts session summaries", () => {
    const out = validateSessionList("session.list", {
      sessions: [{ sessionId: "s1", lastWriteAt: 100, chunkCount: 5 }],
    });
    expect(out.sessions).toEqual([{ sessionId: "s1", lastWriteAt: 100, chunkCount: 5 }]);
  });

  test("validateSessionClear accepts a single-session and an all-sessions result", () => {
    expect(validateSessionClear("session.clear", { ok: true, cleared: "s1" })).toEqual({
      ok: true,
      cleared: "s1",
    });
    expect(validateSessionClear("session.clear", { ok: true, cleared: "all" })).toEqual({
      ok: true,
      cleared: "all",
    });
  });

  test("validateDoraMetrics accepts a fully-populated result with mixed gap codes", () => {
    const out = validateDoraMetrics("metrics.dora", DORA_WIRE);
    expect(out.metrics.deployment_frequency).toEqual(DORA_METRIC_VALUE);
    expect(out.metrics.change_failure_rate.gap).toBe("low_sample");
  });

  test("validateDoraMetrics accepts the unconfigured-service envelope (all null values)", () => {
    const wire = {
      service: "unknown",
      since_ms: 2_592_000_000,
      computed_at: "2026-07-22T00:00:00.000Z",
      metrics: {
        deployment_frequency: { value: null, unit: "deploys_per_day", sample: 0, gap: "no_repos" },
        lead_time_for_changes: { value: null, unit: "seconds_median", sample: 0, gap: "no_repos" },
        change_failure_rate: { value: null, unit: "ratio", sample: 0, gap: "no_repos" },
        mttr: { value: null, unit: "seconds_median", sample: 0, gap: "no_repos" },
      },
    };
    const out = validateDoraMetrics("metrics.dora", wire);
    expect(out.metrics.deployment_frequency.value).toBeNull();
    expect(out.metrics.mttr.gap).toBe("no_repos");
  });

  test("validateDeployPreflight accepts an empty-findings ok verdict", () => {
    const out = validateDeployPreflight("deploy.preflight", PREFLIGHT_WIRE);
    expect(out.verdict).toBe("ok");
    expect(out.checks.active_p1_incidents).toEqual({ count: 0, findings: [], gap: null });
  });

  test("validateDeployPreflight accepts warn verdict with populated findings and null urls", () => {
    const wire = {
      ...PREFLIGHT_WIRE,
      verdict: "warn",
      checks: {
        active_p1_incidents: {
          count: 1,
          findings: [
            {
              id: "PD1",
              title: "t",
              status: "acknowledged",
              severity: "critical",
              opened_at_ms: 1,
              pagerduty_service_id: "svc",
              url: null,
            },
          ],
          gap: null,
        },
        failing_ci_runs: {
          count: 1,
          findings: [
            {
              id: "r1",
              title: "t",
              conclusion: "cancelled",
              modified_at_ms: 1,
              branch: "main",
              head_sha: null,
              url: null,
            },
          ],
          gap: null,
        },
        merge_conflicts: {
          count: 1,
          findings: [
            {
              id: "pr1",
              title: "t",
              number: 1,
              mergeable_state: "dirty",
              modified_at_ms: 1,
              url: null,
            },
          ],
          gap: null,
        },
      },
    };
    const out = validateDeployPreflight("deploy.preflight", wire);
    expect(out.verdict).toBe("warn");
    expect(out.checks.active_p1_incidents.findings[0]?.status).toBe("acknowledged");
    expect(out.checks.failing_ci_runs.findings[0]?.conclusion).toBe("cancelled");
    expect(out.checks.merge_conflicts.findings[0]?.mergeable_state).toBe("dirty");
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

  test("validateAuditVerify rejects a missing lastVerifiedId", () => {
    expect(() => validateAuditVerify("m", { ok: true, verifiedRows: 1 })).toThrow(
      /"lastVerifiedId" must be a finite number/,
    );
  });

  test("validateAuditSummary rejects a non-numeric byOutcome value", () => {
    expect(() =>
      validateAuditSummary("m", { byOutcome: { approved: "many" }, byService: {}, total: 0 }),
    ).toThrow(/"byOutcome" values must be numbers/);
  });

  test("validateAuditSummary rejects a non-numeric byService value", () => {
    expect(() =>
      validateAuditSummary("m", { byOutcome: {}, byService: { github: "many" }, total: 0 }),
    ).toThrow(/"byService" values must be numbers/);
  });

  test("validateAuditToolCalls rejects a non-string/non-null sessionId", () => {
    expect(() =>
      validateAuditToolCalls("m", {
        toolCalls: [
          {
            id: 1,
            sessionId: 7,
            toolId: "t",
            service: "s",
            calledAt: 1,
            durationMs: 1,
            resultEnvelope: "{}",
            status: "ok",
            params: null,
          },
        ],
        hasMore: false,
        nextCursor: null,
      }),
    ).toThrow(/"sessionId" must be a string or null/);
  });

  test("validateAuditToolCalls rejects an invalid status", () => {
    expect(() =>
      validateAuditToolCalls("m", {
        toolCalls: [
          {
            id: 1,
            sessionId: null,
            toolId: "t",
            service: "s",
            calledAt: 1,
            durationMs: 1,
            resultEnvelope: "{}",
            status: "pending",
            params: null,
          },
        ],
        hasMore: false,
        nextCursor: null,
      }),
    ).toThrow(/"status" must be "ok" or "error"/);
  });

  test("validateAuditToolCalls rejects a non-array toolCalls", () => {
    expect(() =>
      validateAuditToolCalls("m", { toolCalls: "nope", hasMore: false, nextCursor: null }),
    ).toThrow(/expected an array/);
  });

  test("validateAuditToolCalls rejects a missing nextCursor field", () => {
    expect(() => validateAuditToolCalls("m", { toolCalls: [], hasMore: false })).toThrow(
      IpcResponseError,
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

  test("validateSessionRecall rejects an invalid chunk role", () => {
    expect(() =>
      validateSessionRecall("session.recall", {
        chunks: [{ chunkText: "a", role: "system", createdAt: 1, distance: 0.1 }],
      }),
    ).toThrow(/"role" must be "user", "assistant", or "tool"/);
  });

  test("validateSessionRecall rejects a non-array chunks", () => {
    expect(() => validateSessionRecall("session.recall", { chunks: "nope" })).toThrow(
      /expected an array/,
    );
  });

  test("validateSessionList rejects a non-numeric chunkCount", () => {
    expect(() =>
      validateSessionList("session.list", {
        sessions: [{ sessionId: "s1", lastWriteAt: 1, chunkCount: "many" }],
      }),
    ).toThrow(/"chunkCount" must be a finite number/);
  });

  test("validateSessionClear rejects a missing cleared field", () => {
    expect(() => validateSessionClear("session.clear", { ok: true })).toThrow(
      /"cleared" must be a string/,
    );
  });

  test("validateDoraMetrics rejects an unrecognised gap code (defends against a defanged check)", () => {
    expect(() =>
      validateDoraMetrics("metrics.dora", {
        ...DORA_WIRE,
        metrics: {
          ...DORA_WIRE.metrics,
          deployment_frequency: { ...DORA_METRIC_VALUE, gap: "bogus" },
        },
      }),
    ).toThrow(/must be a recognised DORA gap code or null/);
  });

  test("validateDoraMetrics rejects a non-number/non-null metric value", () => {
    expect(() =>
      validateDoraMetrics("metrics.dora", {
        ...DORA_WIRE,
        metrics: {
          ...DORA_WIRE.metrics,
          deployment_frequency: { ...DORA_METRIC_VALUE, value: "2.5" },
        },
      }),
    ).toThrow(/"deployment_frequency.value" must be a number or null/);
  });

  test("validateDoraMetrics rejects a missing metrics object", () => {
    expect(() => validateDoraMetrics("metrics.dora", { service: "x" })).toThrow(
      /expected an object/,
    );
  });

  test("validateDeployPreflight rejects an invalid verdict", () => {
    expect(() =>
      validateDeployPreflight("deploy.preflight", { ...PREFLIGHT_WIRE, verdict: "fail" }),
    ).toThrow(/"verdict" must be "ok" or "warn"/);
  });

  test("validateDeployPreflight rejects an unrecognised gap code", () => {
    expect(() =>
      validateDeployPreflight("deploy.preflight", {
        ...PREFLIGHT_WIRE,
        checks: {
          ...PREFLIGHT_WIRE.checks,
          active_p1_incidents: { count: 0, findings: [], gap: "bogus" },
        },
      }),
    ).toThrow(/must be a recognised preflight gap code or null/);
  });

  test("validateDeployPreflight rejects an invalid incident status", () => {
    expect(() =>
      validateDeployPreflight("deploy.preflight", {
        ...PREFLIGHT_WIRE,
        checks: {
          ...PREFLIGHT_WIRE.checks,
          active_p1_incidents: {
            count: 1,
            findings: [
              {
                id: "PD1",
                title: "t",
                status: "resolved",
                severity: "critical",
                opened_at_ms: 1,
                pagerduty_service_id: "svc",
                url: null,
              },
            ],
            gap: null,
          },
        },
      }),
    ).toThrow(/"status" must be "triggered" or "acknowledged"/);
  });

  test("validateDeployPreflight rejects an invalid ci conclusion", () => {
    expect(() =>
      validateDeployPreflight("deploy.preflight", {
        ...PREFLIGHT_WIRE,
        checks: {
          ...PREFLIGHT_WIRE.checks,
          failing_ci_runs: {
            count: 1,
            findings: [
              {
                id: "r1",
                title: "t",
                conclusion: "success",
                modified_at_ms: 1,
                branch: "main",
                head_sha: null,
                url: null,
              },
            ],
            gap: null,
          },
        },
      }),
    ).toThrow(/"conclusion" must be "failure", "cancelled", or "timed_out"/);
  });

  test("validateDeployPreflight rejects a non-string/non-null finding url", () => {
    expect(() =>
      validateDeployPreflight("deploy.preflight", {
        ...PREFLIGHT_WIRE,
        checks: {
          ...PREFLIGHT_WIRE.checks,
          merge_conflicts: {
            count: 1,
            findings: [
              {
                id: "pr1",
                title: "t",
                number: 1,
                mergeable_state: "dirty",
                modified_at_ms: 1,
                url: 7,
              },
            ],
            gap: null,
          },
        },
      }),
    ).toThrow(/"url" must be a string or null/);
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

const SYNC_STATUS_WIRE = {
  serviceId: "github",
  status: "ok",
  lastSyncAt: 1,
  nextSyncAt: 2,
  intervalMs: 300_000,
  itemCount: 5,
  lastError: null,
  consecutiveFailures: 0,
  depth: "metadata_only",
  enabled: true,
};

describe("validateConnectorSyncStatusList / validateConnectorStatusResult", () => {
  test("accepts a well-formed list and optional health fields", () => {
    const out = validateConnectorSyncStatusList("m", [
      { ...SYNC_STATUS_WIRE, healthState: "healthy", healthRetryAfterMs: null },
    ]);
    expect(out[0]?.healthState).toBe("healthy");
    expect(out[0]?.healthRetryAfterMs).toBeNull();
  });

  test("rejects an unrecognised status value", () => {
    expect(() =>
      validateConnectorSyncStatusList("m", [{ ...SYNC_STATUS_WIRE, status: "bogus" }]),
    ).toThrow(/"status" must be a recognised connector status/);
  });

  test("rejects an unrecognised depth value", () => {
    expect(() =>
      validateConnectorSyncStatusList("m", [{ ...SYNC_STATUS_WIRE, depth: "bogus" }]),
    ).toThrow(/"depth" must be/);
  });

  test("connectorStatus result omits telemetry when absent and includes it when present", () => {
    const withoutTelemetry = validateConnectorStatusResult("m", SYNC_STATUS_WIRE);
    expect(withoutTelemetry.telemetry).toBeUndefined();

    const withTelemetry = validateConnectorStatusResult("m", {
      ...SYNC_STATUS_WIRE,
      telemetry: [
        {
          startedAt: 1,
          durationMs: 2,
          itemsUpserted: 3,
          itemsDeleted: 0,
          bytesTransferred: null,
          hadMore: false,
          errorMsg: null,
        },
      ],
    });
    expect(withTelemetry.telemetry).toHaveLength(1);
  });
});

describe("validateConnectorHealthHistory", () => {
  test("accepts a well-formed row with a null fromState/reason", () => {
    const out = validateConnectorHealthHistory("m", [
      {
        id: 1,
        connectorId: "github",
        fromState: null,
        toState: "healthy",
        reason: null,
        occurredAtMs: 5,
      },
    ]);
    expect(out[0]?.fromState).toBeNull();
  });

  test("rejects a row missing toState", () => {
    expect(() =>
      validateConnectorHealthHistory("m", [{ id: 1, connectorId: "github", occurredAtMs: 5 }]),
    ).toThrow(IpcResponseError);
  });
});

describe("validateConnectorSetConfig", () => {
  test("accepts every field null (nothing was requested)", () => {
    expect(
      validateConnectorSetConfig("m", {
        service: "github",
        intervalMs: null,
        depth: null,
        enabled: null,
      }),
    ).toEqual({ service: "github", intervalMs: null, depth: null, enabled: null });
  });

  test("rejects a non-boolean, non-null enabled", () => {
    expect(() =>
      validateConnectorSetConfig("m", {
        service: "github",
        intervalMs: null,
        depth: null,
        enabled: "yes",
      }),
    ).toThrow(/"enabled" must be a boolean or null/);
  });
});

describe("validateConnectorReindex", () => {
  test("accepts a shallow and a deepen result", () => {
    expect(
      validateConnectorReindex("m", { itemsAffected: 2, depth: "metadata_only", mode: "shallow" }),
    ).toEqual({ itemsAffected: 2, depth: "metadata_only", mode: "shallow" });
    expect(
      validateConnectorReindex("m", { itemsAffected: 0, depth: "full", mode: "deepen" }),
    ).toEqual({ itemsAffected: 0, depth: "full", mode: "deepen" });
  });

  test("accepts the gateway's third mode variant", () => {
    // `connectors/reindex.ts:14` declares "deepen" | "shallow" | "same". "same" is
    // currently unreachable in reindexConnector(), but the declared type is the
    // contract — rejecting it would throw on a legitimate response if that branch
    // is ever activated.
    expect(
      validateConnectorReindex("m", { itemsAffected: 0, depth: "summary", mode: "same" }),
    ).toEqual({ itemsAffected: 0, depth: "summary", mode: "same" });
  });

  test("rejects an unrecognised mode", () => {
    expect(() =>
      validateConnectorReindex("m", { itemsAffected: 0, depth: "full", mode: "bogus" }),
    ).toThrow(/"mode" must be "shallow", "deepen", or "same"/);
  });

  test("rejects an unrecognised depth", () => {
    expect(() =>
      validateConnectorReindex("m", { itemsAffected: 0, depth: "bogus", mode: "shallow" }),
    ).toThrow(/"depth" must be/);
  });
});

describe("validateConnectorAuth", () => {
  test("accepts the uniform success shape", () => {
    expect(
      validateConnectorAuth("m", { ok: true, serviceId: "github", scopesGranted: ["repo"] }),
    ).toEqual({ ok: true, serviceId: "github", scopesGranted: ["repo"] });
  });

  test("rejects ok: false — connector.auth never returns a resolved failure shape", () => {
    expect(() =>
      validateConnectorAuth("m", { ok: false, serviceId: "github", scopesGranted: [] }),
    ).toThrow(/"ok" must be true/);
  });

  test("rejects a non-string entry in scopesGranted", () => {
    expect(() =>
      validateConnectorAuth("m", { ok: true, serviceId: "github", scopesGranted: [1] }),
    ).toThrow(/"scopesGranted" must contain only strings/);
  });
});

describe("validateConnectorAddMcp / validateConnectorRemove — HITL dual-shape", () => {
  test("addMcp accepts the approved shape", () => {
    expect(validateConnectorAddMcp("m", { ok: true, serviceId: "mcp_x" })).toEqual({
      ok: true,
      serviceId: "mcp_x",
    });
  });

  test("addMcp accepts the denied shape without requiring ok/serviceId", () => {
    expect(validateConnectorAddMcp("m", { status: "rejected", reason: "no" })).toEqual({
      status: "rejected",
      reason: "no",
    });
  });

  test("addMcp rejects ok: false (not a recognised denial, not a valid success)", () => {
    expect(() => validateConnectorAddMcp("m", { ok: false, serviceId: "mcp_x" })).toThrow(
      /"ok" must be true/,
    );
  });

  test("remove accepts the approved shape with vaultKeysRemoved", () => {
    expect(
      validateConnectorRemove("m", { ok: true, itemsDeleted: 2, vaultKeysRemoved: ["a.b"] }),
    ).toEqual({ ok: true, itemsDeleted: 2, vaultKeysRemoved: ["a.b"] });
  });

  test("remove accepts the denied shape", () => {
    expect(validateConnectorRemove("m", { status: "rejected", reason: "no" })).toEqual({
      status: "rejected",
      reason: "no",
    });
  });

  test("remove rejects a non-string entry in vaultKeysRemoved", () => {
    expect(() =>
      validateConnectorRemove("m", { ok: true, itemsDeleted: 0, vaultKeysRemoved: [1] }),
    ).toThrow(/"vaultKeysRemoved" must contain only strings/);
  });
});

describe("validateWorkflowList / validateWorkflowSave / validateWorkflowListRuns / validateWorkflowRun", () => {
  test("workflowList accepts the raw snake_case row shape", () => {
    const out = validateWorkflowList("m", {
      workflows: [
        {
          id: "wf-1",
          name: "n",
          description: null,
          steps_json: "[]",
          created_at: 1,
          updated_at: 2,
        },
      ],
    });
    expect(out.workflows[0]?.steps_json).toBe("[]");
  });

  test("workflowList rejects a row missing steps_json", () => {
    expect(() =>
      validateWorkflowList("m", {
        workflows: [{ id: "wf-1", name: "n", description: null, created_at: 1, updated_at: 2 }],
      }),
    ).toThrow(IpcResponseError);
  });

  test("workflowSave accepts { id }", () => {
    expect(validateWorkflowSave("m", { id: "wf-1" })).toEqual({ id: "wf-1" });
  });

  test("workflowListRuns accepts a still-running row (nulls) and a finished row", () => {
    const out = validateWorkflowListRuns("m", {
      runs: [
        {
          id: "r1",
          startedAt: 1,
          finishedAt: null,
          durationMs: null,
          status: "running",
          errorMsg: null,
          dryRun: false,
          paramsOverrideJson: null,
          triggeredBy: "cli",
        },
      ],
    });
    expect(out.runs[0]?.finishedAt).toBeNull();
  });

  test("workflowListRuns rejects a row with a non-boolean dryRun", () => {
    expect(() =>
      validateWorkflowListRuns("m", {
        runs: [
          {
            id: "r1",
            startedAt: 1,
            finishedAt: null,
            durationMs: null,
            status: "running",
            errorMsg: null,
            dryRun: "no",
            paramsOverrideJson: null,
            triggeredBy: "cli",
          },
        ],
      }),
    ).toThrow(IpcResponseError);
  });

  test("workflowRun accepts step results with/without label/output/error", () => {
    const out = validateWorkflowRun("m", {
      runId: "run-1",
      dryRun: false,
      stepResults: [
        { label: "s1", status: "ok", output: "done" },
        { status: "error", error: "boom" },
      ],
    });
    expect(out.stepResults).toEqual([
      { label: "s1", status: "ok", output: "done" },
      { status: "error", error: "boom" },
    ]);
  });

  test("workflowRun rejects a stepResults entry missing status", () => {
    expect(() =>
      validateWorkflowRun("m", { runId: "run-1", dryRun: false, stepResults: [{}] }),
    ).toThrow(IpcResponseError);
  });
});
