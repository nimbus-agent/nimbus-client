import { describe, expect, test } from "bun:test";

import { AGENT_KIND, AGENT_NAMES, BRIEF_GUARDS } from "@nimbus-dev/sdk";
import { parseBriefReady } from "../src/agents.ts";
import golden from "./fixtures/agent-briefs.json" with { type: "json" };

/**
 * The agents.* conformance gate.
 *
 * `parseBriefReady` and the SDK guards hand-transcribe the gateway's
 * notification contract; nothing links them at compile time. This pins them to
 * payloads real gateway code emitted, so a shape change upstream fails here
 * rather than silently yielding a rejected brief in every client.
 *
 * When this fails: regenerate via Nimbus `scripts/gen-agent-brief-fixtures.ts`,
 * then fix the parser or guard. Never edit the fixture to make it pass.
 */
const fixtures = golden as Record<string, { sessionId: string; brief: string; findings: unknown }>;

describe("agents.* briefReady conformance", () => {
  test("the fixture covers all eight agents", () => {
    expect(Object.keys(fixtures).sort()).toEqual([...AGENT_NAMES].sort());
  });

  for (const agent of AGENT_NAMES) {
    describe(agent, () => {
      test("the golden payload parses", () => {
        expect(parseBriefReady(agent, fixtures[agent])).not.toBeNull();
      });

      test("findings passes the SDK guard", () => {
        expect(BRIEF_GUARDS[agent](fixtures[agent]?.findings)).toBe(true);
      });

      test("kind matches AGENT_KIND, not the agent name", () => {
        const f = fixtures[agent]?.findings as Record<string, unknown>;
        expect(f["kind"]).toBe(AGENT_KIND[agent]);
      });

      test("the brief envelope is well-formed", () => {
        const f = fixtures[agent]?.findings as Record<string, unknown>;
        expect(typeof fixtures[agent]?.sessionId).toBe("string");
        expect(typeof fixtures[agent]?.brief).toBe("string");
        expect(f["agentVersion"]).toBe(1);
        expect(Array.isArray(f["gaps"])).toBe(true);
      });
    });
  }
});
