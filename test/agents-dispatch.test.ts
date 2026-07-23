import { describe, expect, test } from "bun:test";
import { AGENT_KIND, AGENT_NAMES, type AgentBrief, type AgentName } from "@nimbus-dev/sdk";

import { MockClient } from "../src/mock-client.ts";
import type { NimbusClientLike } from "../src/nimbus-client.ts";
import { FakeIpc, makeClient } from "./_fake-ipc.ts";
import golden from "./fixtures/agent-briefs.json" with { type: "json" };

/**
 * Proves every `agentsX` method dispatches to its OWN agent, on both the real
 * client and `MockClient`.
 *
 * This is the one mistake the type system cannot be relied on to catch in
 * isolation: `runAgent<A>(agent, params)` is generic, and several agents share a
 * parameter shape — `ghost` and `conflicts` are both `{ file, namespace?,
 * namespaces? }`. So `agentsGhost` delegating to `runAgent("conflicts", …)`
 * type-checks at the call site; only the `implements NimbusClientLike` clause
 * catches it, and only because the brief types differ structurally.
 *
 * Briefs come from the conformance fixture rather than being written here, so
 * these assertions run against payloads real gateway code emitted.
 */

const fixtures = golden as Record<
  AgentName,
  { sessionId: string; brief: string; findings: AgentBrief }
>;

/** Minimal valid params per agent, matching the gateway's own validators. */
const PARAMS = {
  expert: { topicOrFile: "src/x.ts" },
  impact: { fileOrPrUrl: "src/x.ts" },
  catchup: {},
  ghost: { file: "src/x.ts" },
  conflicts: { file: "src/x.ts" },
  huddle: {},
  janitor: { resourceRef: "repo:acme/x#branch/wip" },
  preflight: { ref: "HEAD", namespace: "payments" },
} as const;

/** Invoke each public method by name, so a mis-wired delegation shows up here. */
const CALL: Record<AgentName, (c: NimbusClientLike) => Promise<AgentBrief>> = {
  expert: (c) => c.agentsExpert(PARAMS.expert),
  impact: (c) => c.agentsImpact(PARAMS.impact),
  catchup: (c) => c.agentsCatchup(PARAMS.catchup),
  ghost: (c) => c.agentsGhost(PARAMS.ghost),
  conflicts: (c) => c.agentsConflicts(PARAMS.conflicts),
  huddle: (c) => c.agentsHuddle(PARAMS.huddle),
  janitor: (c) => c.agentsJanitor(PARAMS.janitor),
  preflight: (c) => c.agentsPreflight(PARAMS.preflight),
};

describe("every agentsX method dispatches to its own agent", () => {
  for (const agent of AGENT_NAMES) {
    describe(agent, () => {
      test("calls agents.<name> and resolves that agent's brief", async () => {
        const sessionId = `sess-${agent}`;
        const ipc = new FakeIpc([{ sessionId }]);
        const client = makeClient(ipc);

        const pending = CALL[agent](client);
        // Emitted before the RPC response is observed, so it lands in the buffer —
        // the same path the correlator tests cover.
        ipc.emit(`${agent}.briefReady`, { ...fixtures[agent], sessionId });

        const findings = await pending;

        expect(ipc.calls[0]?.method).toBe(`agents.${agent}`);
        expect(findings.kind).toBe(AGENT_KIND[agent]);
      });

      test("a brief from a DIFFERENT agent is not accepted", async () => {
        const other = agent === "expert" ? "impact" : "expert";
        const sessionId = `sess-${agent}`;
        const ipc = new FakeIpc([{ sessionId }]);
        const client = makeClient(ipc);

        const pending = CALL[agent](client);
        // Right session, wrong agent's payload: the guard must reject it, so the
        // call times out rather than resolving with another agent's brief.
        ipc.emit(`${agent}.briefReady`, { ...fixtures[other], sessionId });
        ipc.emit(`${agent}.briefError`, { sessionId, error: "guard rejected the payload" });

        await expect(pending).rejects.toThrow("guard rejected the payload");
      });

      test("MockClient returns the fixture configured for that agent", async () => {
        const mock = new MockClient({ agentBriefs: { [agent]: fixtures[agent].findings } });
        const findings = await CALL[agent](mock);
        expect(findings.kind).toBe(AGENT_KIND[agent]);
      });

      test("MockClient rejects naming the agent whose fixture is missing", async () => {
        const mock = new MockClient({});
        await expect(CALL[agent](mock)).rejects.toThrow(`agentBriefs.${agent}`);
      });
    });
  }

  test("MockClient.subscribeAgentBrief is an inert disposable", () => {
    const sub = new MockClient({}).subscribeAgentBrief("expert", () => {
      throw new Error("mock must never invoke the handler");
    });
    expect(() => sub.dispose()).not.toThrow();
  });
});
