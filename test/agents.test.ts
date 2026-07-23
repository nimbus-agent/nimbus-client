import { describe, expect, test } from "bun:test";
import { AgentBriefError, parseBriefError, parseBriefReady } from "../src/agents.ts";

const base = { agentVersion: 1, generatedAt: 1, latencyMs: 1, gaps: [] };
const expertFindings = { ...base, kind: "expert", query: { topicOrFile: "x" }, ranked: [] };

describe("brief payload parsing", () => {
  test("a well-formed briefReady payload narrows", () => {
    const ev = parseBriefReady("expert", {
      sessionId: "expert_1_ab",
      brief: "# hi",
      findings: expertFindings,
    });
    expect(ev?.ok).toBe(true);
    expect(ev?.sessionId).toBe("expert_1_ab");
  });

  test("findings failing the guard is rejected, not passed through", () => {
    expect(
      parseBriefReady("expert", {
        sessionId: "s",
        brief: "x",
        findings: { ...base, kind: "expert", ranked: [] },
      }),
    ).toBeNull();
  });

  test("a briefError payload narrows to the failure branch", () => {
    const ev = parseBriefError({ sessionId: "s", error: "index empty" });
    expect(ev).toEqual({ ok: false, sessionId: "s", error: "index empty" });
  });

  test("AgentBriefError carries the gateway message", () => {
    const e = new AgentBriefError("expert", "s", "index empty");
    expect(e.message).toContain("index empty");
    expect(e.agent).toBe("expert");
  });
});
