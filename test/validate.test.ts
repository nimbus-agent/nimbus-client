import { describe, expect, test } from "bun:test";

import {
  IpcResponseError,
  validateAgentInvoke,
  validateAgentSession,
  validateAuditList,
  validateEgressHead,
  validateEgressList,
  validateEgressProveWindow,
  validateEgressVerify,
  validateOk,
  validateQueryItems,
  validateQuerySql,
  validateRankedItems,
  validateSessionTranscript,
} from "../src/validate.ts";

const ROW = {
  id: 1,
  timestamp: 1000,
  sourceType: "gmail",
  sourceId: "abc",
  destination: "github",
  method: "POST",
  payloadSummary: "…",
  hitlStatus: "approved",
  resultStatus: "authorized",
  rowHash: "h1",
  prevHash: "h0",
};

describe("validate — happy paths", () => {
  test("validateAgentInvoke accepts a record with/without reply", () => {
    expect(validateAgentInvoke("m", { reply: "hi", extra: 1 })).toEqual({ reply: "hi", extra: 1 });
    expect(validateAgentInvoke("m", {})).toEqual({});
  });

  test("validateOk accepts { ok }", () => {
    expect(validateOk("m", { ok: true })).toEqual({ ok: true });
  });

  test("validateSessionTranscript accepts turns and optional auditLogId", () => {
    const t = validateSessionTranscript("m", {
      sessionId: "s",
      hasMore: false,
      turns: [{ role: "user", text: "hi", timestamp: 1, auditLogId: 9 }],
    });
    expect(t.turns[0]).toEqual({ role: "user", text: "hi", timestamp: 1, auditLogId: 9 });
  });

  test("validateQueryItems accepts a camelCase indexed item", () => {
    expect(
      validateQueryItems("m", {
        items: [{ id: "s1", indexPrimaryKey: "s:s1", service: "s", itemType: "alert", name: "n" }],
        meta: { limit: 1, total: 1 },
      }),
    ).toEqual({
      items: [{ id: "s1", indexPrimaryKey: "s:s1", service: "s", itemType: "alert", name: "n" }],
      meta: { limit: 1, total: 1 },
    });
  });

  test("validateQueryItems rejects a row that is not an indexed item", () => {
    expect(() =>
      validateQueryItems("m", { items: [{ a: 1 }], meta: { limit: 1, total: 1 } }),
    ).toThrow(IpcResponseError);
  });

  test("validateRankedItems accepts rows with the ranking fields", () => {
    const rows = validateRankedItems("m", [
      { id: "x", score: 1, indexPrimaryKey: "pk", indexedType: "file" },
    ]);
    expect(rows).toHaveLength(1);
  });

  test("validateQuerySql / validateAuditList accept arrays", () => {
    expect(validateQuerySql("m", { rows: [{ a: 1 }] })).toEqual({ rows: [{ a: 1 }] });
    expect(validateAuditList("m", [1, 2])).toEqual([1, 2]);
  });

  test("validateEgressHead / List / Verify accept valid shapes", () => {
    expect(validateEgressHead("m", { head: "h", count: 2 })).toEqual({ head: "h", count: 2 });
    expect(validateEgressList("m", { rows: [ROW] }).rows[0]).toMatchObject({ id: 1 });
    expect(
      validateEgressVerify("m", { ok: false, verifiedRows: 3, brokenAt: 2, reason: "x" }),
    ).toEqual({ ok: false, verifiedRows: 3, brokenAt: 2, reason: "x" });
  });

  test("validateEgressProveWindow accepts rows/completeness/verify and optional receipt", () => {
    const out = validateEgressProveWindow("m", {
      rows: [ROW],
      completeness: { tier: "authorized-actions", outboundEgressEvents: 0 },
      verify: { ok: true, verifiedRows: 1 },
      receipt: { sigB64: "s", pubkeyB64: "p", digest: "d" },
    });
    expect(out.receipt).toEqual({ sigB64: "s", pubkeyB64: "p", digest: "d" });
    expect(out.completeness.outboundEgressEvents).toBe(0);
  });

  test("egress row accepts null sourceId", () => {
    const out = validateEgressList("m", { rows: [{ ...ROW, sourceId: null }] });
    expect(out.rows[0]?.sourceId).toBeNull();
  });
});

describe("validate — rejections throw IpcResponseError", () => {
  test("non-object where object expected", () => {
    expect(() => validateOk("egress.head", 42)).toThrow(IpcResponseError);
    expect(() => validateOk("egress.head", null)).toThrow(/Invalid egress.head/);
    expect(() => validateOk("m", [])).toThrow(/expected an object/);
  });

  test("wrong field types", () => {
    expect(() => validateEgressHead("m", { head: 1, count: 2 })).toThrow(/"head" must be a string/);
    expect(() => validateEgressHead("m", { head: "h", count: "2" })).toThrow(/finite number/);
    expect(() => validateOk("m", { ok: "yes" })).toThrow(/"ok" must be a boolean/);
    expect(() => validateAgentInvoke("m", { reply: 5 })).toThrow(/"reply" must be a string/);
  });

  test("non-array where array expected", () => {
    expect(() => validateAuditList("m", { not: "array" })).toThrow(/expected an array/);
    expect(() => validateQuerySql("m", { rows: "nope" })).toThrow(/expected an array/);
  });

  test("ranked item missing required ranking fields", () => {
    expect(() => validateRankedItems("m", [{ id: "x", score: 1 }])).toThrow(/indexPrimaryKey/);
  });

  test("transcript with an invalid role", () => {
    expect(() =>
      validateSessionTranscript("m", {
        sessionId: "s",
        hasMore: false,
        turns: [{ role: "system", text: "x", timestamp: 1 }],
      }),
    ).toThrow(/"role" must be/);
  });

  test("prove-window with wrong completeness tier", () => {
    expect(() =>
      validateEgressProveWindow("m", {
        rows: [],
        completeness: { tier: "everything", outboundEgressEvents: 0 },
        verify: { ok: true, verifiedRows: 0 },
      }),
    ).toThrow(/"tier" must be/);
  });

  test("egress row with a non-string/non-null sourceId", () => {
    expect(() => validateEgressList("m", { rows: [{ ...ROW, sourceId: 7 }] })).toThrow(
      /"sourceId" must be a string or null/,
    );
  });
});

describe("validateAgentSession", () => {
  test("accepts a well-formed session envelope", () => {
    expect(validateAgentSession("agents.expert", { sessionId: "expert_1_ab" })).toEqual({
      sessionId: "expert_1_ab",
    });
  });

  test("rejects a missing sessionId", () => {
    expect(() => validateAgentSession("agents.expert", {})).toThrow(IpcResponseError);
  });

  test("rejects a non-object", () => {
    expect(() => validateAgentSession("agents.expert", "nope")).toThrow(IpcResponseError);
  });
});
