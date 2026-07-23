import { describe, expect, test } from "bun:test";

import type { HitlRequest } from "../src/stream-events.ts";
import { IpcResponseError } from "../src/validate.ts";
import { FakeIpc, makeClient } from "./_fake-ipc.ts";

describe("NimbusClient method dispatch", () => {
  test("agentInvoke sends defaults and omits undefined optionals", async () => {
    const ipc = new FakeIpc([{ reply: "ok" }]);
    await makeClient(ipc).agentInvoke("hello");
    expect(ipc.calls[0]).toEqual({
      method: "agent.invoke",
      params: { input: "hello", stream: false },
    });
  });

  test("agentInvoke includes sessionId + agent when provided", async () => {
    const ipc = new FakeIpc([{}]);
    await makeClient(ipc).agentInvoke("hi", { stream: true, sessionId: "s1", agent: "a1" });
    expect(ipc.calls[0]?.params).toEqual({
      input: "hi",
      stream: true,
      sessionId: "s1",
      agent: "a1",
    });
  });

  test("getSessionTranscript / cancelStream / querySql / auditList route correctly", async () => {
    const ipc = new FakeIpc([
      { sessionId: "s", turns: [], hasMore: false },
      { ok: true },
      { rows: [] },
      [],
    ]);
    const c = makeClient(ipc);
    await c.getSessionTranscript({ sessionId: "s" });
    await c.cancelStream("stream-9");
    await c.querySql("SELECT 1");
    await c.auditList();
    expect(ipc.calls.map((x) => x.method)).toEqual([
      "engine.getSessionTranscript",
      "engine.cancelStream",
      "index.querySql",
      "audit.list",
    ]);
    expect(ipc.calls[1]?.params).toEqual({ streamId: "stream-9" });
    expect(ipc.calls[3]?.params).toEqual({ limit: 50 });
  });

  test("auditList passes a custom limit", async () => {
    const ipc = new FakeIpc([[]]);
    await makeClient(ipc).auditList(7);
    expect(ipc.calls[0]?.params).toEqual({ limit: 7 });
  });

  test("queryItems forwards all filter params", async () => {
    const ipc = new FakeIpc([{ items: [], meta: { limit: 0, total: 0 } }]);
    await makeClient(ipc).queryItems({ services: ["github"], types: ["pr"], limit: 5 });
    expect(ipc.calls[0]).toMatchObject({ method: "index.queryItems" });
    const params = ipc.calls[0]?.params as Record<string, unknown>;
    expect(params["services"]).toEqual(["github"]);
  });

  test("searchRanked routes to index.searchRanked and returns the rows", async () => {
    // A RankedSearchItem is a NimbusItem plus ranking fields, so the base item
    // fields are required. They were absent while tests went untypechecked;
    // validateRankedItems casts, so only the compiler could have caught it.
    const row = {
      id: "x",
      service: "drive",
      itemType: "file",
      name: "x",
      score: 1,
      indexPrimaryKey: "pk-x",
      indexedType: "file",
    };
    const ipc = new FakeIpc([[row]]);
    const out = await makeClient(ipc).searchRanked({
      name: "plan",
      service: "drive",
      itemType: "file",
      limit: 5,
      semantic: false,
      contextChunks: 1,
    });
    expect(ipc.calls[0]?.method).toBe("index.searchRanked");
    expect(ipc.calls[0]?.params).toMatchObject({
      name: "plan",
      service: "drive",
      itemType: "file",
      limit: 5,
      semantic: false,
      contextChunks: 1,
    });
    expect(out).toEqual([row]);
  });

  test("searchRanked tolerates being called with no params", async () => {
    const ipc = new FakeIpc([[]]);
    const out = await makeClient(ipc).searchRanked();
    expect(ipc.calls[0]?.method).toBe("index.searchRanked");
    expect(out).toEqual([]);
  });

  test("egress read methods route to the right JSON-RPC methods", async () => {
    const ipc = new FakeIpc([
      { head: "abc", count: 3 },
      { rows: [] },
      { ok: true, verifiedRows: 3 },
      {
        rows: [],
        completeness: { tier: "authorized-actions", outboundEgressEvents: 0 },
        verify: { ok: true, verifiedRows: 3 },
      },
    ]);
    const c = makeClient(ipc);
    const head = await c.egressHead();
    await c.egressList();
    await c.egressVerify();
    await c.egressProveWindow();
    expect(ipc.calls.map((x) => x.method)).toEqual([
      "egress.head",
      "egress.list",
      "egress.verify",
      "egress.proveWindow",
    ]);
    expect(head).toEqual({ head: "abc", count: 3 });
  });

  test("egressList forwards window + limit params", async () => {
    const ipc = new FakeIpc([{ rows: [] }]);
    await makeClient(ipc).egressList({ since: 10, until: 20, limit: 5 });
    expect(ipc.calls[0]?.method).toBe("egress.list");
    expect(ipc.calls[0]?.params).toEqual({ since: 10, until: 20, limit: 5 });
  });

  test("egressProveWindow forwards since/until/sign", async () => {
    const ipc = new FakeIpc([
      {
        rows: [],
        completeness: { tier: "authorized-actions", outboundEgressEvents: 0 },
        verify: { ok: true, verifiedRows: 0 },
      },
    ]);
    await makeClient(ipc).egressProveWindow({ since: 1, until: 2, sign: true });
    expect(ipc.calls[0]?.method).toBe("egress.proveWindow");
    expect(ipc.calls[0]?.params).toEqual({ since: 1, until: 2, sign: true });
  });

  test("auditVerify defaults to full: undefined (incremental) and validates the result", async () => {
    const ipc = new FakeIpc([{ ok: true, verifiedRows: 5, lastVerifiedId: 5 }]);
    const result = await makeClient(ipc).auditVerify();
    expect(ipc.calls[0]).toEqual({ method: "audit.verify", params: { full: undefined } });
    expect(result).toEqual({ ok: true, verifiedRows: 5, lastVerifiedId: 5 });
  });

  test("auditVerify forwards full: true and surfaces a break", async () => {
    const ipc = new FakeIpc([
      {
        ok: false,
        verifiedRows: 2,
        lastVerifiedId: 2,
        firstBreakAtId: 3,
        reason: "row_hash mismatch",
      },
    ]);
    const result = await makeClient(ipc).auditVerify({ full: true });
    expect(ipc.calls[0]?.params).toEqual({ full: true });
    expect(result).toEqual({
      ok: false,
      verifiedRows: 2,
      lastVerifiedId: 2,
      firstBreakAtId: 3,
      reason: "row_hash mismatch",
    });
  });

  test("auditGetSummary routes to audit.getSummary and validates counts", async () => {
    const ipc = new FakeIpc([
      { byOutcome: { approved: 3, rejected: 1 }, byService: { github: 4 }, total: 4 },
    ]);
    const result = await makeClient(ipc).auditGetSummary();
    expect(ipc.calls[0]).toEqual({ method: "audit.getSummary", params: undefined });
    expect(result).toEqual({
      byOutcome: { approved: 3, rejected: 1 },
      byService: { github: 4 },
      total: 4,
    });
  });

  test("auditToolCalls forwards all filter params and validates the page", async () => {
    const entry = {
      id: 1,
      sessionId: "s1",
      toolId: "github.issue.create",
      service: "github",
      calledAt: 100,
      durationMs: 5,
      resultEnvelope: "{}",
      status: "ok" as const,
      params: { a: 1 },
    };
    const ipc = new FakeIpc([
      { toolCalls: [entry], hasMore: true, nextCursor: { calledAt: 100, id: 1 } },
    ]);
    const result = await makeClient(ipc).auditToolCalls({
      since: 1,
      until: 2,
      limit: 10,
      sessionId: "s1",
      toolId: "github.issue.create",
      status: "ok",
      cursor: { calledAt: 0, id: 0 },
    });
    expect(ipc.calls[0]).toEqual({
      method: "audit.toolCalls",
      params: {
        since: 1,
        until: 2,
        limit: 10,
        sessionId: "s1",
        toolId: "github.issue.create",
        status: "ok",
        cursor: { calledAt: 0, id: 0 },
      },
    });
    expect(result).toEqual({
      toolCalls: [entry],
      hasMore: true,
      nextCursor: { calledAt: 100, id: 1 },
    });
  });

  test("auditToolCalls tolerates no params and a null nextCursor", async () => {
    const ipc = new FakeIpc([{ toolCalls: [], hasMore: false, nextCursor: null }]);
    const result = await makeClient(ipc).auditToolCalls();
    expect(ipc.calls[0]?.method).toBe("audit.toolCalls");
    expect(result).toEqual({ toolCalls: [], hasMore: false, nextCursor: null });
  });

  test("consentRespond sends requestId + approved and validates { ok }", async () => {
    const ipc = new FakeIpc([{ ok: true }]);
    const result = await makeClient(ipc).consentRespond({ requestId: "r1", approved: true });
    expect(ipc.calls[0]).toEqual({
      method: "consent.respond",
      params: { requestId: "r1", approved: true },
    });
    expect(result).toEqual({ ok: true });
  });

  test("consentRespond propagates a Gateway rejection (unknown/foreign request)", async () => {
    const ipc = new FakeIpc();
    ipc.call = async () => {
      throw new Error("Unknown or foreign consent request");
    };
    await expect(
      makeClient(ipc).consentRespond({ requestId: "bogus", approved: false }),
    ).rejects.toThrow(/Unknown or foreign consent request/);
  });

  test("gatewayPing sends includeDrift and validates the core + drift", async () => {
    const ipc = new FakeIpc([
      {
        version: "0.22.0",
        uptime: 12345,
        agentLimits: { maxAgentDepth: 6, maxToolCallsPerSession: 40 },
        drift: { lines: ["3 items changed since last sync"] },
        embeddingModel: "minilm",
      },
    ]);
    const result = await makeClient(ipc).gatewayPing({ includeDrift: true });
    expect(ipc.calls[0]).toEqual({
      method: "gateway.ping",
      params: { includeDrift: true },
    });
    expect(result.version).toBe("0.22.0");
    expect(result.drift).toEqual({ lines: ["3 items changed since last sync"] });
    // Extra keys (the embeddingStatus spread) pass through untyped.
    expect(result["embeddingModel"]).toBe("minilm");
  });

  test("gatewayPing with no params omits drift", async () => {
    const ipc = new FakeIpc([
      {
        version: "0.22.0",
        uptime: 1,
        agentLimits: { maxAgentDepth: 6, maxToolCallsPerSession: 40 },
      },
    ]);
    const result = await makeClient(ipc).gatewayPing();
    expect(result.drift).toBeUndefined();
  });

  test("diagGetVersion routes to diag.getVersion and validates commit/buildId nullability", async () => {
    const ipc = new FakeIpc([
      { version: "0.22.0", commit: "abc123", buildId: null, uptimeMs: 500 },
    ]);
    const result = await makeClient(ipc).diagGetVersion();
    expect(ipc.calls[0]?.method).toBe("diag.getVersion");
    expect(result).toEqual({ version: "0.22.0", commit: "abc123", buildId: null, uptimeMs: 500 });
  });

  test("indexMetrics routes to index.metrics and validates the field list", async () => {
    const ipc = new FakeIpc([
      {
        itemCountByService: { github: 10, gmail: 5 },
        totalItems: 15,
        indexSizeBytes: 4096,
        embeddingCoveragePercent: 87.5,
        lastSuccessfulSyncByConnector: { github: 1700000000000, gmail: null },
        queryLatencyP50Ms: 1,
        queryLatencyP95Ms: 3,
        queryLatencyP99Ms: 8,
      },
    ]);
    const result = await makeClient(ipc).indexMetrics();
    expect(ipc.calls[0]?.method).toBe("index.metrics");
    expect(result.itemCountByService).toEqual({ github: 10, gmail: 5 });
    expect(result.lastSuccessfulSyncByConnector).toEqual({ github: 1700000000000, gmail: null });
  });

  test("diagSnapshot routes to diag.snapshot and validates the nested shape", async () => {
    const ipc = new FakeIpc([
      {
        gateway: { version: "0.22.0", uptimeMs: 999 },
        connectorHealth: [{ connectorId: "github", state: "healthy", backoffAttempt: 0 }],
        index: {
          itemCountByService: {},
          totalItems: 0,
          indexSizeBytes: 0,
          embeddingCoveragePercent: 0,
          lastSuccessfulSyncByConnector: {},
          queryLatencyP50Ms: 0,
          queryLatencyP95Ms: 0,
          queryLatencyP99Ms: 0,
        },
        hitl: { pendingConsentRequests: 2 },
        watchers: [{ id: "w1", name: "watch1", enabled: true, lastFiredAtMs: null }],
        auditLogTail: [{ id: 1 }],
        extensions: {
          disabled_pre_t2: 0,
          signature_disabled_count: 1,
          auto_update: { cached_updates_count: 2, interval_hours: 24, air_gap_blocked: false },
        },
        sandbox: {
          platform_capabilities: { network: "per_host", reason: null },
          linux_helper: { available: true, reason: null },
          stale_rules_count: 0,
        },
      },
    ]);
    const result = await makeClient(ipc).diagSnapshot();
    expect(ipc.calls[0]?.method).toBe("diag.snapshot");
    expect(result.hitl).toEqual({ pendingConsentRequests: 2 });
    expect(result.connectorHealth).toEqual([
      { connectorId: "github", state: "healthy", backoffAttempt: 0 },
    ]);
    expect(result.extensions.auto_update).toEqual({
      cached_updates_count: 2,
      interval_hours: 24,
      air_gap_blocked: false,
    });
    expect(result.sandbox.linux_helper).toEqual({ available: true, reason: null });
  });

  test("adminStatus routes to admin.status and validates the full snapshot", async () => {
    const ipc = new FakeIpc([
      {
        policy: { signatureValid: true, pendingRestart: false, source: "anchor", org: "acme" },
        peers: [{ peerId: "p1", reachable: true, lastSeenMs: 1 }],
        connectors: [
          { id: "github", enabled: true, blockedByPolicy: false, health: "healthy", lastSyncMs: 5 },
        ],
        namespaces: [{ name: "eng", subscribers: 2 }],
        audit: { chainLength: 100, lastHash: "abcd", appendRate1h: 3 },
        hitl: { pendingApprovals: 1, pendingQuorum: 0 },
        identity: { operatorValid: true, externalId: "ext-1" },
        syncFreshnessMs: 42,
      },
    ]);
    const result = await makeClient(ipc).adminStatus();
    expect(ipc.calls[0]?.method).toBe("admin.status");
    expect(result.policy).toEqual({
      signatureValid: true,
      pendingRestart: false,
      source: "anchor",
      org: "acme",
    });
    expect(result.identity).toEqual({ operatorValid: true, externalId: "ext-1" });
  });

  test("adminStatus rejects when the Gateway answers Method not found (statusReaders unwired)", async () => {
    const ipc = new FakeIpc();
    ipc.call = async () => {
      throw new Error("Method not found: admin.status");
    };
    await expect(makeClient(ipc).adminStatus()).rejects.toThrow(/Method not found/);
  });

  test("askStream returns a handle with a string streamId", async () => {
    const ipc = new FakeIpc([{ streamId: "stream-1" }]);
    const h = makeClient(ipc).askStream("hi");
    expect(typeof h.streamId).toBe("string");
  });

  test("subscribeHitl forwards valid batches and filters malformed ones", () => {
    const ipc = new FakeIpc();
    const got: HitlRequest[] = [];
    makeClient(ipc).subscribeHitl((r) => got.push(r));
    ipc.emit("agent.hitlBatch", { requestId: "r1", prompt: "Approve?", streamId: "s1" });
    ipc.emit("agent.hitlBatch", { requestId: "r2", prompt: "No stream" });
    ipc.emit("agent.hitlBatch", { prompt: "no requestId" });
    ipc.emit("agent.hitlBatch", null);
    expect(got).toHaveLength(2);
    expect(got[0]).toMatchObject({ requestId: "r1", prompt: "Approve?", streamId: "s1" });
    expect(got[1]).toMatchObject({ requestId: "r2", prompt: "No stream" });
    expect(got[1]).not.toHaveProperty("streamId");
  });

  test("close disconnects the transport", async () => {
    const ipc = new FakeIpc();
    let disconnected = false;
    ipc.disconnect = async () => {
      disconnected = true;
    };
    await makeClient(ipc).close();
    expect(disconnected).toBe(true);
  });

  test("sessionAppend sends sessionId/chunkText/role and validates { ok }", async () => {
    const ipc = new FakeIpc([{ ok: true }]);
    const result = await makeClient(ipc).sessionAppend({
      sessionId: "s1",
      chunkText: "hello there",
      role: "assistant",
    });
    expect(ipc.calls[0]).toEqual({
      method: "session.append",
      params: { sessionId: "s1", chunkText: "hello there", role: "assistant" },
    });
    expect(result).toEqual({ ok: true });
  });

  test("sessionRecall forwards sessionId/query/topK and validates chunks", async () => {
    const ipc = new FakeIpc([
      {
        chunks: [
          { chunkText: "hit one", role: "user", createdAt: 100, distance: 0.1 },
          { chunkText: "hit two", role: "tool", createdAt: 200, distance: 0.4 },
        ],
      },
    ]);
    const result = await makeClient(ipc).sessionRecall({
      sessionId: "s1",
      query: "find me",
      topK: 4,
    });
    expect(ipc.calls[0]).toEqual({
      method: "session.recall",
      params: { sessionId: "s1", query: "find me", topK: 4 },
    });
    expect(result).toEqual({
      chunks: [
        { chunkText: "hit one", role: "user", createdAt: 100, distance: 0.1 },
        { chunkText: "hit two", role: "tool", createdAt: 200, distance: 0.4 },
      ],
    });
  });

  test("sessionRecall tolerates an omitted topK", async () => {
    const ipc = new FakeIpc([{ chunks: [] }]);
    await makeClient(ipc).sessionRecall({ sessionId: "s1", query: "q" });
    expect(ipc.calls[0]?.params).toEqual({ sessionId: "s1", query: "q", topK: undefined });
  });

  test("sessionList sends no params and validates the session summaries", async () => {
    const ipc = new FakeIpc([
      { sessions: [{ sessionId: "s1", lastWriteAt: 1000, chunkCount: 3 }] },
    ]);
    const result = await makeClient(ipc).sessionList();
    expect(ipc.calls[0]).toEqual({ method: "session.list", params: undefined });
    expect(result).toEqual({ sessions: [{ sessionId: "s1", lastWriteAt: 1000, chunkCount: 3 }] });
  });

  test("sessionClear forwards sessionId and validates { ok, cleared }", async () => {
    const ipc = new FakeIpc([{ ok: true, cleared: "s1" }]);
    const result = await makeClient(ipc).sessionClear({ sessionId: "s1" });
    expect(ipc.calls[0]).toEqual({ method: "session.clear", params: { sessionId: "s1" } });
    expect(result).toEqual({ ok: true, cleared: "s1" });
  });

  test("sessionClear with no params clears every session", async () => {
    const ipc = new FakeIpc([{ ok: true, cleared: "all" }]);
    const result = await makeClient(ipc).sessionClear();
    expect(ipc.calls[0]).toEqual({ method: "session.clear", params: { sessionId: undefined } });
    expect(result).toEqual({ ok: true, cleared: "all" });
  });

  test("metricsDora forwards service/since and validates a fully-populated result", async () => {
    const ipc = new FakeIpc([
      {
        service: "checkout",
        since_ms: 2_592_000_000,
        computed_at: "2026-07-22T00:00:00.000Z",
        metrics: {
          deployment_frequency: { value: 2.5, unit: "deploys_per_day", sample: 40, gap: null },
          lead_time_for_changes: { value: 3600, unit: "seconds_median", sample: 40, gap: null },
          change_failure_rate: { value: 0.05, unit: "ratio", sample: 40, gap: null },
          mttr: { value: 900, unit: "seconds_median", sample: 40, gap: null },
        },
      },
    ]);
    const result = await makeClient(ipc).metricsDora({ service: "checkout", since: "7d" });
    expect(ipc.calls[0]).toEqual({
      method: "metrics.dora",
      params: { service: "checkout", since: "7d" },
    });
    expect(result.metrics.deployment_frequency).toEqual({
      value: 2.5,
      unit: "deploys_per_day",
      sample: 40,
      gap: null,
    });
  });

  test("metricsDora with an unconfigured service returns null values with a gap code, not a rejection", async () => {
    // Mirrors the Gateway's unconfiguredEnvelope() — an unknown service id
    // resolves successfully rather than the RPC rejecting.
    const ipc = new FakeIpc([
      {
        service: "unknown-service",
        since_ms: 2_592_000_000,
        computed_at: "2026-07-22T00:00:00.000Z",
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
    ]);
    const result = await makeClient(ipc).metricsDora({ service: "unknown-service" });
    expect(result.metrics.deployment_frequency.value).toBeNull();
    expect(result.metrics.deployment_frequency.gap).toBe("no_repos");
    expect(result.metrics.mttr).toEqual({
      value: null,
      unit: "seconds_median",
      sample: 0,
      gap: "no_repos",
    });
  });

  test("deployPreflight forwards service/target_ref/max_findings and validates findings", async () => {
    const ipc = new FakeIpc([
      {
        service: "checkout",
        target_ref: "refs/heads/main",
        computed_at: "2026-07-22T00:00:00.000Z",
        verdict: "warn",
        checks: {
          active_p1_incidents: {
            count: 1,
            findings: [
              {
                id: "PD1",
                title: "Checkout down",
                status: "triggered",
                severity: "critical",
                opened_at_ms: 100,
                pagerduty_service_id: "svc-1",
                url: "https://pagerduty.example/incidents/PD1",
              },
            ],
            gap: null,
          },
          failing_ci_runs: {
            count: 1,
            findings: [
              {
                id: "run-1",
                title: "CI",
                conclusion: "failure",
                modified_at_ms: 200,
                branch: "main",
                head_sha: "abc123",
                url: null,
              },
            ],
            gap: null,
          },
          merge_conflicts: {
            count: 1,
            findings: [
              {
                id: "pr-1",
                title: "PR",
                number: 42,
                mergeable_state: "dirty",
                modified_at_ms: 300,
                url: "https://github.example/pr/42",
              },
            ],
            gap: null,
          },
        },
      },
    ]);
    const result = await makeClient(ipc).deployPreflight({
      service: "checkout",
      targetRef: "refs/heads/main",
      maxFindings: 5,
    });
    expect(ipc.calls[0]).toEqual({
      method: "deploy.preflight",
      params: { service: "checkout", target_ref: "refs/heads/main", max_findings: 5 },
    });
    expect(result.verdict).toBe("warn");
    expect(result.checks.active_p1_incidents.findings[0]?.status).toBe("triggered");
    expect(result.checks.failing_ci_runs.findings[0]?.head_sha).toBe("abc123");
    expect(result.checks.merge_conflicts.findings[0]?.number).toBe(42);
  });

  test("deployPreflight with an unconfigured service returns verdict ok with gap codes", async () => {
    const ipc = new FakeIpc([
      {
        service: "unknown-service",
        target_ref: "main",
        computed_at: "2026-07-22T00:00:00.000Z",
        verdict: "ok",
        checks: {
          active_p1_incidents: { count: 0, findings: [], gap: "no_pagerduty_mapping" },
          failing_ci_runs: { count: 0, findings: [], gap: "no_repos" },
          merge_conflicts: { count: 0, findings: [], gap: "no_repos" },
        },
      },
    ]);
    const result = await makeClient(ipc).deployPreflight({
      service: "unknown-service",
      targetRef: "main",
    });
    expect(result.verdict).toBe("ok");
    expect(result.checks.active_p1_incidents).toEqual({
      count: 0,
      findings: [],
      gap: "no_pagerduty_mapping",
    });
  });
});

describe("queryItems result validation", () => {
  test("returns the gateway's camelCase item verbatim", async () => {
    const ipc = new FakeIpc([
      {
        items: [
          {
            id: "run-1",
            indexPrimaryKey: "github:run-1",
            service: "github",
            itemType: "ci_run",
            name: "nightly build",
            modifiedAt: 1_700_000_000_000,
            createdAt: 1_600_000_000_000,
            url: "https://example.test/r/1",
            mimeType: "application/json",
            sizeBytes: 12,
            parentId: "github:wf-9",
          },
        ],
        meta: { limit: 50, total: 1 },
      },
    ]);

    const { items, meta } = await makeClient(ipc).queryItems({ limit: 50 });

    expect(items[0]).toEqual({
      id: "run-1",
      indexPrimaryKey: "github:run-1",
      service: "github",
      itemType: "ci_run",
      name: "nightly build",
      mimeType: "application/json",
      sizeBytes: 12,
      createdAt: 1_600_000_000_000,
      modifiedAt: 1_700_000_000_000,
      url: "https://example.test/r/1",
      parentId: "github:wf-9",
    });
    expect(meta).toEqual({ limit: 50, total: 1 });
  });

  test("omits optional fields the item does not carry", async () => {
    const ipc = new FakeIpc([
      {
        items: [{ id: "x1", indexPrimaryKey: "x:x1", service: "x", itemType: "file", name: "n" }],
        meta: { limit: 1, total: 1 },
      },
    ]);
    const { items } = await makeClient(ipc).queryItems({});
    expect(items[0]).toEqual({
      id: "x1",
      indexPrimaryKey: "x:x1",
      service: "x",
      itemType: "file",
      name: "n",
    });
  });

  test("preserves an item type this client version does not know", async () => {
    const ipc = new FakeIpc([
      {
        items: [
          { id: "x1", indexPrimaryKey: "x:x1", service: "x", itemType: "dora_metric", name: "n" },
        ],
        meta: { limit: 1, total: 1 },
      },
    ]);
    const { items } = await makeClient(ipc).queryItems({});
    expect(items[0]?.itemType).toBe("dora_metric");
  });

  test("throws IpcResponseError when items is not an array", async () => {
    const ipc = new FakeIpc([{ items: "nope", meta: { limit: 0, total: 0 } }]);
    await expect(makeClient(ipc).queryItems({})).rejects.toBeInstanceOf(IpcResponseError);
  });

  test("throws IpcResponseError when indexPrimaryKey is missing", async () => {
    const ipc = new FakeIpc([
      {
        items: [{ id: "x1", service: "x", itemType: "file", name: "n" }],
        meta: { limit: 1, total: 1 },
      },
    ]);
    await expect(makeClient(ipc).queryItems({})).rejects.toBeInstanceOf(IpcResponseError);
  });

  test("throws IpcResponseError on a snake_case row from an old gateway", async () => {
    // Version skew: client 0.6.0 against a pre-Task-2 gateway. Failing loudly
    // is intended — the alternative is silently undefined fields.
    const ipc = new FakeIpc([
      {
        items: [{ id: "github:run-1", service: "github", type: "ci_run", title: "nightly" }],
        meta: { limit: 1, total: 1 },
      },
    ]);
    await expect(makeClient(ipc).queryItems({})).rejects.toBeInstanceOf(IpcResponseError);
  });
});
