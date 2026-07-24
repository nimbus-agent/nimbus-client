import { expect, test } from "bun:test";
import type { WhyBrief, WhyPeek } from "@nimbus-dev/sdk";
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
