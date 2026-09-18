import { describe, expect, test } from "bun:test";

import { AGENT_KIND, AGENT_NAMES, BRIEF_GUARDS } from "@nimbus-dev/sdk";
import { parseBriefReady, SUPPORTED_AGENT_NAMES } from "../src/agents.ts";
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
  test("the fixture covers every agent this client implements", () => {
    expect(Object.keys(fixtures).sort()).toEqual([...SUPPORTED_AGENT_NAMES].sort());
  });

  test("every supported agent is still a name the SDK knows", () => {
    // The direction that would break callers: an agent this client dispatches disappearing from the
    // gateway's roster. The reverse — the SDK knowing agents this client has no method for — is
    // expected, and asserted below rather than treated as a failure.
    const known = new Set<string>(AGENT_NAMES);
    expect(SUPPORTED_AGENT_NAMES.filter((a) => !known.has(a))).toEqual([]);
  });

  test("agents the SDK knows but this client does not implement are named, not silent", () => {
    // SDK 2.0.0 added `decisions`, `glossary` and `ownership`, and this client has no method for
    // them, so they are outside the conformance loop below. Naming them here keeps the gap a stated
    // fact rather than nine passing tests that read like full coverage.
    const supported = new Set<string>(SUPPORTED_AGENT_NAMES);
    const unimplemented = [...AGENT_NAMES].filter((a) => !supported.has(a)).sort();
    expect(unimplemented).toEqual(["decisions", "glossary", "ownership"]);
  });

  for (const agent of SUPPORTED_AGENT_NAMES) {
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
