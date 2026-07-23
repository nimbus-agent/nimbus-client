import { describe, expect, test } from "bun:test";

import { MockClient } from "../src/mock-client.ts";

/**
 * Exercises every `MockClient` stub with **no fixtures configured**.
 *
 * Each stub reads `this.fixtures.X ?? <default>`, so the default is a second
 * branch that nothing else reaches — `mock-client.ts` sat at 49% lines, which is
 * what failed the coverage gate on this wave.
 *
 * The defaults are worth pinning for their own sake: `new MockClient({})` is the
 * shape a scaffold or a downstream test gets for free, and a default that
 * contradicts the real wire shape (fabricated DORA numbers, a missing
 * `nextCursor`) teaches a consumer to write code that breaks against a live
 * Gateway.
 */

const c = new MockClient({});

describe("MockClient defaults — session.*", () => {
  test("append/recall/list/clear resolve without fixtures", async () => {
    expect(await c.sessionAppend({ sessionId: "s", chunkText: "t", role: "user" })).toEqual({
      ok: true,
    });
    expect((await c.sessionRecall({ sessionId: "s", query: "q" })).chunks).toEqual([]);
    expect((await c.sessionList()).sessions).toEqual([]);

    // `cleared` echoes WHICH session was dropped ("all" when unscoped); a default
    // omitting it would hide a field consumers branch on.
    expect(await c.sessionClear()).toEqual({ ok: true, cleared: "all" });
  });

  test("cancelStream and transcript defaults", async () => {
    expect(await c.cancelStream()).toEqual({ ok: true });
    const t = await c.getSessionTranscript({ sessionId: "s" });
    expect(t.turns).toEqual([]);
    expect(t.hasMore).toBe(false);
  });
});

describe("MockClient defaults — read surfaces are empty, not absent", () => {
  test("query/search/sql/audit-list", async () => {
    expect(await c.queryItems({})).toEqual({ items: [], meta: { limit: 0, total: 0 } });
    expect(await c.searchRanked()).toEqual([]);
    expect(await c.querySql("select 1")).toEqual({ rows: [] });
    expect(await c.auditList()).toEqual([]);
  });

  test("audit.*", async () => {
    expect(await c.auditVerify()).toEqual({ ok: true, verifiedRows: 0, lastVerifiedId: 0 });
    expect(await c.auditGetSummary()).toEqual({ byOutcome: {}, byService: {}, total: 0 });
    // null, not undefined — the wire distinguishes "no next page" from "absent".
    expect(await c.auditToolCalls()).toEqual({ toolCalls: [], hasMore: false, nextCursor: null });
  });

  test("egress.*", async () => {
    expect(await c.egressHead()).toEqual({ head: "", count: 0 });
    expect(await c.egressList()).toEqual({ rows: [] });
    expect(await c.egressVerify()).toEqual({ ok: true, verifiedRows: 0 });

    const prove = await c.egressProveWindow();
    expect(prove.rows).toEqual([]);
    expect(prove.completeness.tier).toBe("authorized-actions");
    expect(prove.verify.ok).toBe(true);
  });

  test("diagnostics", async () => {
    expect(await c.consentRespond({ requestId: "r", approved: true })).toEqual({ ok: true });
    expect((await c.gatewayPing()).version).toBe("mock");
    expect(await c.diagGetVersion()).toEqual({
      version: "mock",
      commit: null,
      buildId: null,
      uptimeMs: 0,
    });
    expect((await c.indexMetrics()).totalItems).toBe(0);
    // diagSnapshot embeds the same default metrics object.
    expect((await c.diagSnapshot()).index.totalItems).toBe(0);
    expect((await c.adminStatus()).identity.operatorValid).toBe(true);
  });
});

describe("MockClient defaults — metrics and preflight model NO DATA", () => {
  test("metrics.dora defaults to null values with a gap code, not invented numbers", async () => {
    const d = await c.metricsDora({ service: "svc" });
    // A live Gateway with no repos indexed returns exactly this: null value plus
    // the reason. Inventing a deploy frequency here would let a consumer ship
    // rendering code that never handles the real, common case.
    expect(d.metrics.deployment_frequency).toEqual({
      value: null,
      unit: "deploys_per_day",
      sample: 0,
      gap: "no_repos",
    });
    expect(d.metrics.mttr.value).toBeNull();
  });

  test("deploy.preflight default", async () => {
    const p = await c.deployPreflight({ service: "svc", targetRef: "HEAD" });
    expect(p.verdict).toBe("ok");
    expect(p.checks.failing_ci_runs).toEqual({ count: 0, findings: [], gap: "no_repos" });
  });
});

describe("MockClient defaults — connector.*", () => {
  test("reads default to empty, and status echoes the requested service", async () => {
    expect(await c.connectorListStatus()).toEqual([]);
    expect(await c.connectorHealthHistory({ service: "github" })).toEqual([]);

    const s = await c.connectorStatus({ serviceId: "github" });
    // Echoing the id matters: a fixed "mock" id would make a consumer's
    // "did I get the connector I asked for?" assertion pass vacuously.
    expect(s.serviceId).toBe("github");
    expect(s.status).toBe("ok");
  });

  test("mutating calls resolve ok", async () => {
    expect(await c.connectorPause({ serviceId: "github" })).toEqual({ ok: true });
    expect(await c.connectorResume({ serviceId: "github" })).toEqual({ ok: true });
    expect(await c.connectorSetInterval({ serviceId: "github", intervalMs: 60_000 })).toEqual({
      ok: true,
    });
    expect(await c.connectorSync({ serviceId: "github" })).toEqual({ ok: true });
  });

  test("setConfig reports null for fields the caller did not send", async () => {
    // null here means "not part of this request", NOT "cleared" — the real
    // Gateway response has the same ambiguity, so the mock must reproduce it.
    expect(await c.connectorSetConfig({ serviceId: "github", depth: "full" })).toEqual({
      service: "github",
      intervalMs: null,
      depth: "full",
      enabled: null,
    });
  });

  test("auth default is the uniform cross-provider success shape", async () => {
    expect(await c.connectorAuth({ serviceId: "github", personalAccessToken: "x" })).toEqual({
      ok: true,
      serviceId: "github",
      scopesGranted: [],
    });
  });

  test("the HITL-gated pair defaults to APPROVED, not denied", async () => {
    // Defaulting to a rejection would make every unconfigured scaffold look like
    // a denied consent gate. Callers rehearsing the denial path configure the
    // fixture explicitly — asserted below.
    const add = await c.connectorAddMcp({ serviceId: "mcp_x", commandLine: "cmd" });
    expect(add).toEqual({ ok: true, serviceId: "mcp_x" });
    expect(await c.connectorRemove({ serviceId: "github" })).toEqual({
      ok: true,
      itemsDeleted: 0,
      vaultKeysRemoved: [],
    });
  });

  test("reindex echoes the requested depth and falls back to metadata_only", async () => {
    expect(await c.connectorReindex({ service: "github" })).toEqual({
      itemsAffected: 0,
      depth: "metadata_only",
      mode: "shallow",
    });
    expect((await c.connectorReindex({ service: "github", depth: "full" })).depth).toBe("full");
  });
});

describe("MockClient defaults — workflow.*", () => {
  test("list/save/delete/listRuns/run", async () => {
    expect(await c.workflowList()).toEqual({ workflows: [] });
    expect(await c.workflowSave({ name: "w", stepsJson: "[]" })).toEqual({ id: "mock-workflow" });
    expect(await c.workflowDelete({ name: "w" })).toEqual({ ok: true });
    expect(await c.workflowListRuns({ workflowName: "w", limit: 10 })).toEqual({ runs: [] });
  });

  test("run echoes dryRun so a dry-run rehearsal is distinguishable", async () => {
    expect(await c.workflowRun({ name: "w" })).toEqual({
      runId: "mock-run",
      dryRun: false,
      stepResults: [],
    });
    expect((await c.workflowRun({ name: "w", dryRun: true })).dryRun).toBe(true);
  });
});

describe("MockClient — a configured fixture wins over the default", () => {
  test("fixture-backed connector and workflow methods", async () => {
    const m = new MockClient({
      connectorSyncStatuses: [],
      connectorHealthHistory: [
        {
          id: 1,
          connectorId: "github",
          fromState: null,
          toState: "degraded",
          reason: "429",
          occurredAtMs: 1,
        },
      ],
      connectorReindex: { itemsAffected: 7, depth: "full", mode: "deepen" },
      workflowRun: { runId: "run-1", dryRun: true, stepResults: [] },
      workflowListRuns: { runs: [] },
    });

    expect((await m.connectorHealthHistory({ service: "github" }))[0]?.toState).toBe("degraded");
    // The fixture wins even though the params say otherwise — params are ignored
    // once a fixture is set, which is what makes the double deterministic.
    expect(await m.connectorReindex({ service: "s", depth: "metadata_only" })).toEqual({
      itemsAffected: 7,
      depth: "full",
      mode: "deepen",
    });
    expect((await m.workflowRun({ name: "w", dryRun: false })).dryRun).toBe(true);
  });

  test("the gated pair can be configured to the DENIED shape", async () => {
    // The branch that matters: a caller must be able to rehearse a denied consent
    // gate without a live Gateway, or the denial path is untestable downstream.
    const denied = { status: "rejected" as const, reason: "User declined." };
    const m = new MockClient({ connectorRemove: denied, connectorAddMcp: denied });

    expect(await m.connectorRemove({ serviceId: "github" })).toEqual(denied);
    expect(await m.connectorAddMcp({ serviceId: "mcp_x", commandLine: "c" })).toEqual(denied);
  });
});
