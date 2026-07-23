import { describe, expect, test } from "bun:test";

import { IpcResponseError } from "../src/validate.ts";
import { FakeIpc, makeClient } from "./_fake-ipc.ts";

const SYNC_STATUS = {
  serviceId: "github",
  status: "ok" as const,
  lastSyncAt: 100,
  nextSyncAt: 200,
  intervalMs: 300_000,
  itemCount: 42,
  lastError: null,
  consecutiveFailures: 0,
  depth: "metadata_only" as const,
  enabled: true,
};

describe("NimbusClient connector.* dispatch", () => {
  test("connectorListStatus routes to connector.listStatus and validates the array", async () => {
    const ipc = new FakeIpc([[SYNC_STATUS]]);
    const out = await makeClient(ipc).connectorListStatus({ serviceId: "github" });
    expect(ipc.calls[0]).toEqual({
      method: "connector.listStatus",
      params: { serviceId: "github" },
    });
    expect(out).toEqual([SYNC_STATUS]);
  });

  test("connectorListStatus tolerates no params", async () => {
    const ipc = new FakeIpc([[]]);
    const out = await makeClient(ipc).connectorListStatus();
    expect(ipc.calls[0]?.params).toEqual({ serviceId: undefined });
    expect(out).toEqual([]);
  });

  test("connectorStatus forwards includeStats and validates optional telemetry", async () => {
    const ipc = new FakeIpc([
      {
        ...SYNC_STATUS,
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
      },
    ]);
    const out = await makeClient(ipc).connectorStatus({ serviceId: "github", includeStats: true });
    expect(ipc.calls[0]).toEqual({
      method: "connector.status",
      params: { serviceId: "github", includeStats: true },
    });
    expect(out.telemetry).toHaveLength(1);
  });

  test("connectorStatus without telemetry omits the field", async () => {
    const ipc = new FakeIpc([SYNC_STATUS]);
    const out = await makeClient(ipc).connectorStatus({ serviceId: "github" });
    expect(out.telemetry).toBeUndefined();
  });

  test("connectorHealthHistory forwards service + limit and validates rows", async () => {
    const ipc = new FakeIpc([
      [
        {
          id: 1,
          connectorId: "github",
          fromState: "healthy",
          toState: "degraded",
          reason: "timeout",
          occurredAtMs: 500,
        },
      ],
    ]);
    const out = await makeClient(ipc).connectorHealthHistory({ service: "github", limit: 10 });
    expect(ipc.calls[0]).toEqual({
      method: "connector.healthHistory",
      params: { service: "github", limit: 10 },
    });
    expect(out[0]?.fromState).toBe("healthy");
  });

  test("connectorPause / connectorResume / connectorSetInterval / connectorSync route correctly", async () => {
    const ipc = new FakeIpc([{ ok: true }, { ok: true }, { ok: true }, { ok: true }]);
    const c = makeClient(ipc);
    await c.connectorPause({ serviceId: "github" });
    await c.connectorResume({ serviceId: "github" });
    await c.connectorSetInterval({ serviceId: "github", intervalMs: 60_000 });
    await c.connectorSync({ serviceId: "github", full: true });
    expect(ipc.calls.map((x) => x.method)).toEqual([
      "connector.pause",
      "connector.resume",
      "connector.setInterval",
      "connector.sync",
    ]);
    expect(ipc.calls[2]?.params).toEqual({ serviceId: "github", intervalMs: 60_000 });
    expect(ipc.calls[3]?.params).toEqual({ serviceId: "github", full: true });
  });

  test("connectorSetConfig forwards partial updates and validates nullable fields", async () => {
    const ipc = new FakeIpc([
      { service: "github", intervalMs: null, depth: "full", enabled: null },
    ]);
    const out = await makeClient(ipc).connectorSetConfig({ serviceId: "github", depth: "full" });
    expect(ipc.calls[0]).toEqual({
      method: "connector.setConfig",
      params: {
        serviceId: "github",
        intervalMs: undefined,
        depth: "full",
        enabled: undefined,
      },
    });
    expect(out).toEqual({ service: "github", intervalMs: null, depth: "full", enabled: null });
  });

  test("connectorAuth forwards the whole params record and validates the uniform result", async () => {
    const ipc = new FakeIpc([{ ok: true, serviceId: "github", scopesGranted: ["repo"] }]);
    const out = await makeClient(ipc).connectorAuth({
      serviceId: "github",
      personalAccessToken: "tok",
    });
    expect(ipc.calls[0]).toEqual({
      method: "connector.auth",
      params: { serviceId: "github", personalAccessToken: "tok" },
    });
    expect(out).toEqual({ ok: true, serviceId: "github", scopesGranted: ["repo"] });
  });

  test("connectorReindex forwards service + depth and validates the result", async () => {
    const ipc = new FakeIpc([{ itemsAffected: 3, depth: "metadata_only", mode: "shallow" }]);
    const out = await makeClient(ipc).connectorReindex({ service: "github" });
    expect(ipc.calls[0]).toEqual({
      method: "connector.reindex",
      params: { service: "github", depth: undefined },
    });
    expect(out).toEqual({ itemsAffected: 3, depth: "metadata_only", mode: "shallow" });
  });

  test("connectorReindex propagates a denied full-depth reindex as a rejection (not a resolved shape)", async () => {
    const ipc = new FakeIpc();
    ipc.call = async () => {
      throw new Error("User declined consent gate.");
    };
    await expect(
      makeClient(ipc).connectorReindex({ service: "github", depth: "full" }),
    ).rejects.toThrow(/User declined consent gate/);
  });
});

describe("NimbusClient HITL-gated connector.* — dual-shape results", () => {
  test("connectorAddMcp resolves the success shape on approval", async () => {
    const ipc = new FakeIpc([{ ok: true, serviceId: "mcp_foo" }]);
    const out = await makeClient(ipc).connectorAddMcp({
      serviceId: "mcp_foo",
      commandLine: "node server.js",
    });
    expect(ipc.calls[0]).toEqual({
      method: "connector.addMcp",
      params: { serviceId: "mcp_foo", commandLine: "node server.js" },
    });
    expect(out).toEqual({ ok: true, serviceId: "mcp_foo" });
    if ("status" in out) throw new Error("expected the success branch");
    expect(out.serviceId).toBe("mcp_foo");
  });

  test("connectorAddMcp RESOLVES (does not reject) a denial with the rejected shape", async () => {
    const ipc = new FakeIpc([{ status: "rejected", reason: "User declined consent gate." }]);
    const out = await makeClient(ipc).connectorAddMcp({
      serviceId: "mcp_foo",
      commandLine: "node server.js",
    });
    expect(out).toEqual({ status: "rejected", reason: "User declined consent gate." });
    if (!("status" in out)) throw new Error("expected the rejected branch");
    expect(out.reason).toBe("User declined consent gate.");
  });

  test("connectorRemove resolves the success shape on approval", async () => {
    const ipc = new FakeIpc([{ ok: true, itemsDeleted: 12, vaultKeysRemoved: ["github.pat"] }]);
    const out = await makeClient(ipc).connectorRemove({ serviceId: "github" });
    expect(ipc.calls[0]).toEqual({
      method: "connector.remove",
      params: { serviceId: "github", service: "github" },
    });
    expect(out).toEqual({ ok: true, itemsDeleted: 12, vaultKeysRemoved: ["github.pat"] });
  });

  test("connectorRemove RESOLVES (does not reject) a denial with the rejected shape", async () => {
    const ipc = new FakeIpc([{ status: "rejected", reason: "User declined consent gate." }]);
    const out = await makeClient(ipc).connectorRemove({ serviceId: "github" });
    expect(out).toEqual({ status: "rejected", reason: "User declined consent gate." });
  });

  test("connectorAddMcp rejects (throws) when the Gateway result is neither shape", async () => {
    const ipc = new FakeIpc([{ ok: false, serviceId: "mcp_foo" }]);
    await expect(
      makeClient(ipc).connectorAddMcp({ serviceId: "mcp_foo", commandLine: "x" }),
    ).rejects.toThrow(IpcResponseError);
  });
});
