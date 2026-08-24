import { describe, expect, test } from "bun:test";
import type { WhyBrief, WhyPeek } from "@nimbus-dev/sdk";
import { FakeIpc, makeClient } from "../test/_fake-ipc.ts";
import { MockClient } from "./mock-client.js";
import { validateWhyPeek } from "./validate.js";

const brief: WhyBrief = {
  agentVersion: 1,
  generatedAt: 1,
  latencyMs: 1,
  gaps: [],
  kind: "why",
  query: { ref: "src/a.ts", line: 42 },
  subject: { repoRoot: "/r", filePath: "src/a.ts", lineNo: 42, symbol: null },
  findings: [],
};
const peek: WhyPeek = {
  subject: { repoRoot: "/r", filePath: "src/a.ts", lineNo: 42 },
  author: "alice",
  authorEmail: "alice@example.com",
  commitSha: "abc",
  committedAt: 1,
  commitSubject: "fix",
  pr: { number: 1, title: "PR", url: "u" },
  ticket: { key: "NIM-1", title: "T", url: "u" },
  hasMore: true,
};

test("agentsWhy resolves the mock why brief", async () => {
  const c = new MockClient({ agentBriefs: { why: brief } });
  expect(await c.agentsWhy({ ref: "src/a.ts", line: 42 })).toEqual(brief);
});

test("agentsWhyPeek resolves the mock peek", async () => {
  const c = new MockClient({ whyPeek: peek });
  expect(await c.agentsWhyPeek({ ref: "src/a.ts:42" })).toEqual(peek);
});

test("validateWhyPeek accepts a well-formed peek and is lenient about extras", () => {
  expect(validateWhyPeek("agents.whyPeek", { ...peek, futureField: 1 })).toEqual(peek);
});

test("validateWhyPeek rejects a non-boolean hasMore", () => {
  expect(() => validateWhyPeek("agents.whyPeek", { ...peek, hasMore: "yes" })).toThrow();
});

/**
 * The tests above run against `MockClient`, which answers from a fixture and
 * never builds a request — so the REAL client's `agentsWhyPeek` (the only
 * `agents.*` method that is a plain RPC rather than a brief correlation) had no
 * coverage at all: not the method name it sends, not the params it assembles,
 * not the validation of what comes back.
 */
describe("NimbusClient.agentsWhyPeek (the real client, not the mock)", () => {
  test("routes to agents.whyPeek and validates the response", async () => {
    const ipc = new FakeIpc([peek]);
    const out = await makeClient(ipc).agentsWhyPeek({ ref: "src/a.ts:42" });
    expect(ipc.calls[0]?.method).toBe("agents.whyPeek");
    expect(out).toEqual(peek);
  });

  test("omits `line` entirely when the caller did not supply one", async () => {
    // Not `line: undefined` — the gateway's validator sees the KEY, and
    // `toEqual` cannot tell the two apart, so assert on the key itself.
    const ipc = new FakeIpc([peek]);
    await makeClient(ipc).agentsWhyPeek({ ref: "src/a.ts:42" });
    const params = ipc.calls[0]?.params as Record<string, unknown>;
    expect(params).toEqual({ ref: "src/a.ts:42" });
    expect(Object.hasOwn(params, "line")).toBe(false);
  });

  test("forwards an explicit line alongside the ref", async () => {
    const ipc = new FakeIpc([peek]);
    await makeClient(ipc).agentsWhyPeek({ ref: "src/a.ts", line: 42 });
    expect(ipc.calls[0]?.params).toEqual({ ref: "src/a.ts", line: 42 });
  });

  test("rejects a malformed peek rather than handing it to the caller", async () => {
    const ipc = new FakeIpc([{ ...peek, hasMore: "yes" }]);
    await expect(makeClient(ipc).agentsWhyPeek({ ref: "src/a.ts:42" })).rejects.toThrow();
  });
});
