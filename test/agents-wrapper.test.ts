import { describe, expect, test } from "bun:test";
import type { ExpertBrief } from "@nimbus-dev/sdk";

import { AgentBriefError, AgentTimeoutError } from "../src/agents.ts";
import { FakeIpc, makeClient } from "./_fake-ipc.ts";

/**
 * Covers the untested correlator behind the eight `agentsX` public methods:
 * `subscribeAgentBrief` (dual-notification register/dispose) and the private
 * `runAgent` (buffering, session-id filtering, error/timeout cleanup). All
 * reached through the public surface, per the review that flagged the gap.
 */

function expertFindings(topicOrFile = "x"): ExpertBrief {
  return {
    agentVersion: 1,
    generatedAt: 1,
    latencyMs: 1,
    gaps: [],
    kind: "expert",
    query: { topicOrFile },
    ranked: [],
  };
}

describe("subscribeAgentBrief", () => {
  test("registers both notifications and dispose() removes both", () => {
    const ipc = new FakeIpc();
    const sub = makeClient(ipc).subscribeAgentBrief("expert", () => {});

    expect(ipc.notifHandlers.get("expert.briefReady")).toHaveLength(1);
    expect(ipc.notifHandlers.get("expert.briefError")).toHaveLength(1);

    sub.dispose();

    expect(ipc.notifHandlers.get("expert.briefReady")).toHaveLength(0);
    expect(ipc.notifHandlers.get("expert.briefError")).toHaveLength(0);
  });
});

describe("runAgent (via the public agentsX methods)", () => {
  test("a briefReady notification that arrives before the RPC resolves is still delivered", async () => {
    const ipc = new FakeIpc([{ sessionId: "expert_1" }]);
    const client = makeClient(ipc);

    // Do NOT await yet: emit the notification synchronously so it lands
    // before `sessionId` is known to the correlator (the buffering path).
    const pending = client.agentsExpert({ topicOrFile: "x" });
    ipc.emit("expert.briefReady", {
      sessionId: "expert_1",
      brief: "# hi",
      findings: expertFindings(),
    });

    const result = await pending;
    expect(result).toEqual(expertFindings());
  });

  test("two concurrent runs of the same agent do not cross results", async () => {
    const ipc = new FakeIpc([{ sessionId: "expert_A" }, { sessionId: "expert_B" }]);
    const client = makeClient(ipc);

    const runA = client.agentsExpert({ topicOrFile: "a" });
    const runB = client.agentsExpert({ topicOrFile: "b" });

    // Flush microtasks so both RPCs resolve and each correlator's sessionId
    // is known before we emit — otherwise both events would land in the
    // pre-sessionId buffer rather than exercising the live per-session
    // filter this test targets.
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Emit out of order (B's event before A's) so result ordering alone
    // cannot make the assertions pass.
    ipc.emit("expert.briefReady", {
      sessionId: "expert_B",
      brief: "# b",
      findings: expertFindings("b"),
    });
    ipc.emit("expert.briefReady", {
      sessionId: "expert_A",
      brief: "# a",
      findings: expertFindings("a"),
    });

    const [resultA, resultB] = await Promise.all([runA, runB]);
    expect(resultA).toEqual(expertFindings("a"));
    expect(resultB).toEqual(expertFindings("b"));
  });

  test("a briefError notification rejects with AgentBriefError carrying the gateway message", async () => {
    const ipc = new FakeIpc([{ sessionId: "expert_err" }]);
    const client = makeClient(ipc);

    const pending = client.agentsExpert({ topicOrFile: "x" });
    ipc.emit("expert.briefError", { sessionId: "expert_err", error: "index empty" });

    await expect(pending).rejects.toBeInstanceOf(AgentBriefError);
    await expect(pending).rejects.toThrow(/index empty/);
  });

  test("a timeout rejects with AgentTimeoutError and disposes the subscription", async () => {
    const ipc = new FakeIpc([{ sessionId: "expert_slow" }]);
    const client = makeClient(ipc);

    const pending = client.agentsExpert({ topicOrFile: "x" }, { timeoutMs: 25 });

    await expect(pending).rejects.toBeInstanceOf(AgentTimeoutError);

    // The dispose-on-timeout path must have run: no leaked handlers.
    expect(ipc.notifHandlers.get("expert.briefReady")).toHaveLength(0);
    expect(ipc.notifHandlers.get("expert.briefError")).toHaveLength(0);
  });
});
