import { describe, expect, test } from "bun:test";

import { MockClient } from "../src/mock-client.ts";

describe("MockClient", () => {
  test("queryItems returns fixture items", async () => {
    const c = new MockClient({
      items: [
        {
          id: "1",
          indexPrimaryKey: "github:1",
          service: "github",
          itemType: "file",
          name: "Demo",
          modifiedAt: 1,
        },
      ],
    });
    const r = await c.queryItems({});
    expect(r.items).toHaveLength(1);
    expect(r.items[0]?.id).toBe("1");
    await c.close();
  });

  test("agentInvoke returns default then fixture reply", async () => {
    expect((await new MockClient().agentInvoke("hi")).reply).toBe("[MockClient] agent.invoke");
    expect((await new MockClient({ reply: "R" }).agentInvoke("hi")).reply).toBe("R");
  });

  test("askStream yields default tokens then a done event", async () => {
    const evs: { type: string }[] = [];
    for await (const e of new MockClient().askStream("hi")) evs.push(e);
    expect(evs.map((e) => e.type)).toEqual(["token", "token", "done"]);
  });

  test("askStream honours custom streamTokens", async () => {
    const evs: { type: string }[] = [];
    for await (const e of new MockClient({ streamTokens: ["a"] }).askStream("hi")) evs.push(e);
    expect(evs.filter((e) => e.type === "token")).toHaveLength(1);
  });

  test("askStream stops after cancel()", async () => {
    const h = new MockClient().askStream("hi");
    await h.cancel();
    const evs: unknown[] = [];
    for await (const e of h) evs.push(e);
    expect(evs).toEqual([]);
  });

  test("subscribeHitl returns a disposer", () => {
    const sub = new MockClient().subscribeHitl(() => undefined);
    expect(typeof sub.dispose).toBe("function");
    sub.dispose();
  });

  test("getSessionTranscript / cancelStream / querySql / auditList / close", async () => {
    const c = new MockClient();
    // sessionId is required by the interface; the mock ignores it and always
    // answers "mock-session", so passing one changes nothing at runtime.
    expect((await c.getSessionTranscript({ sessionId: "s1" })).sessionId).toBe("mock-session");
    expect(await c.cancelStream()).toEqual({ ok: true });
    expect(await c.querySql("SELECT 1")).toEqual({ rows: [] });
    expect(await c.auditList()).toEqual([]);
    await c.close();
  });

  test("queryItems returns empty meta without fixtures", async () => {
    const r = await new MockClient().queryItems({});
    expect(r).toEqual({ items: [], meta: { limit: 0, total: 0 } });
  });

  test("egress methods return safe defaults without fixtures", async () => {
    const c = new MockClient();
    expect(await c.egressHead()).toEqual({ head: "", count: 0 });
    // Params accepted for drop-in parity with NimbusClient (TS would reject if not).
    expect(await c.egressList({ since: 1, limit: 5 })).toEqual({ rows: [] });
    expect(await c.egressVerify()).toEqual({ ok: true, verifiedRows: 0 });
    expect(await c.egressProveWindow({ since: 1, sign: true })).toEqual({
      rows: [],
      completeness: { tier: "authorized-actions", outboundEgressEvents: 0 },
      verify: { ok: true, verifiedRows: 0 },
    });
  });

  test("egress methods return configured fixtures", async () => {
    const row = {
      id: 1,
      timestamp: 100,
      sourceType: "agent",
      sourceId: "s1",
      destination: "github",
      method: "github.issue.create",
      payloadSummary: "{}",
      hitlStatus: "approved",
      resultStatus: "authorized",
      rowHash: "h1",
      prevHash: "h0",
    };
    const c = new MockClient({
      egressHead: { head: "h1", count: 1 },
      egressRows: [row],
      egressVerify: { ok: false, verifiedRows: 1, brokenAt: 2, reason: "mismatch" },
      egressProveWindow: {
        rows: [row],
        completeness: { tier: "authorized-actions", outboundEgressEvents: 1 },
        verify: { ok: true, verifiedRows: 1 },
      },
    });
    expect((await c.egressHead()).count).toBe(1);
    expect((await c.egressList()).rows).toHaveLength(1);
    expect((await c.egressVerify()).brokenAt).toBe(2);
    expect((await c.egressProveWindow()).completeness.outboundEgressEvents).toBe(1);
  });

  test("searchRanked returns [] by default and ranked fixtures when configured", async () => {
    expect(await new MockClient().searchRanked({ name: "x" })).toEqual([]);
    const c = new MockClient({
      rankedItems: [
        {
          id: "d1",
          service: "drive",
          itemType: "file",
          name: "Plan",
          score: 0.9,
          indexPrimaryKey: "1",
          indexedType: "file",
        },
      ],
    });
    const r = await c.searchRanked();
    expect(r).toHaveLength(1);
    expect(r[0]?.name).toBe("Plan");
  });

  test("agentsExpert returns the configured fixture", async () => {
    const brief = {
      agentVersion: 1 as const,
      generatedAt: 1,
      latencyMs: 1,
      gaps: [],
      kind: "expert" as const,
      query: { topicOrFile: "x" },
      ranked: [],
    };
    const c = new MockClient({ agentBriefs: { expert: brief } });
    expect(await c.agentsExpert({ topicOrFile: "x" })).toEqual(brief);
  });

  test("an unconfigured agent rejects with a named reason", async () => {
    await expect(new MockClient().agentsGhost({ file: "a" })).rejects.toThrow("agentBriefs.ghost");
  });

  test("consentRespond always resolves ok (no HITL loop in-memory)", async () => {
    expect(await new MockClient().consentRespond({ requestId: "r1", approved: true })).toEqual({
      ok: true,
    });
  });

  test("diagnostics methods return safe defaults without fixtures", async () => {
    const c = new MockClient();
    const ping = await c.gatewayPing();
    expect(ping.version).toBe("mock");
    expect(ping.drift).toBeUndefined();
    expect(await c.diagGetVersion()).toEqual({
      version: "mock",
      commit: null,
      buildId: null,
      uptimeMs: 0,
    });
    const metrics = await c.indexMetrics();
    expect(metrics.itemCountByService).toEqual({});
    const snapshot = await c.diagSnapshot();
    expect(snapshot.index).toEqual(metrics);
    expect(snapshot.watchers).toEqual([]);
    const status = await c.adminStatus();
    expect(status.policy).toEqual({ signatureValid: true, pendingRestart: false, source: "none" });
  });

  test("diagnostics methods return configured fixtures", async () => {
    const c = new MockClient({
      gatewayPing: {
        version: "0.22.0",
        uptime: 10,
        agentLimits: { maxAgentDepth: 6, maxToolCallsPerSession: 40 },
      },
      diagVersion: { version: "0.22.0", commit: "abc", buildId: "b1", uptimeMs: 10 },
      indexMetrics: {
        itemCountByService: { github: 1 },
        totalItems: 1,
        indexSizeBytes: 10,
        embeddingCoveragePercent: 100,
        lastSuccessfulSyncByConnector: { github: 1 },
        queryLatencyP50Ms: 1,
        queryLatencyP95Ms: 1,
        queryLatencyP99Ms: 1,
      },
      diagSnapshot: {
        gateway: { version: "0.22.0", uptimeMs: 10 },
        connectorHealth: [],
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
        hitl: { pendingConsentRequests: 3 },
        watchers: [],
        auditLogTail: [],
        extensions: { disabled_pre_t2: 0, signature_disabled_count: 0 },
        sandbox: {
          platform_capabilities: { network: "all_or_nothing", reason: "no runner" },
          linux_helper: null,
          stale_rules_count: 0,
        },
      },
      adminStatus: {
        policy: { signatureValid: true, pendingRestart: false, source: "peer" },
        peers: [],
        connectors: [],
        namespaces: [],
        audit: { chainLength: 1, lastHash: "h", appendRate1h: 0 },
        hitl: { pendingApprovals: 0, pendingQuorum: 0 },
        identity: { operatorValid: true },
        syncFreshnessMs: 1,
      },
    });
    expect((await c.gatewayPing()).version).toBe("0.22.0");
    expect((await c.diagGetVersion()).commit).toBe("abc");
    expect((await c.indexMetrics()).totalItems).toBe(1);
    expect((await c.diagSnapshot()).hitl).toEqual({ pendingConsentRequests: 3 });
    expect((await c.adminStatus()).policy.source).toBe("peer");
  });
});
