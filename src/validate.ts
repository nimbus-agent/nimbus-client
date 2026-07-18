/**
 * Runtime validation for Gateway JSON-RPC results.
 *
 * `IPCClient.call<T>()` asserts the wire payload is `T` without checking it. The
 * public {@link NimbusClient} methods run the raw `unknown` through these guards
 * so a malformed or version-skewed Gateway response fails loudly at the call
 * site (with an {@link IpcResponseError}) instead of silently corrupting typed
 * data downstream. Guards check the required shape and are lenient about extra
 * or optional fields.
 */

import type {
  EgressCompleteness,
  EgressHead,
  EgressListResult,
  EgressProveWindowResult,
  EgressReceipt,
  EgressRow,
  EgressVerifyResult,
  RankedSearchItem,
  SessionTranscript,
} from "./nimbus-client.js";

/** Thrown when a Gateway response does not match its expected shape. */
export class IpcResponseError extends Error {
  constructor(method: string, detail: string) {
    super(`Invalid ${method} response: ${detail}`);
    this.name = "IpcResponseError";
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function record(method: string, v: unknown): Record<string, unknown> {
  if (!isRecord(v)) throw new IpcResponseError(method, "expected an object");
  return v;
}

function str(method: string, o: Record<string, unknown>, key: string): string {
  const v = o[key];
  if (typeof v !== "string") throw new IpcResponseError(method, `"${key}" must be a string`);
  return v;
}

function num(method: string, o: Record<string, unknown>, key: string): number {
  const v = o[key];
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new IpcResponseError(method, `"${key}" must be a finite number`);
  }
  return v;
}

function bool(method: string, o: Record<string, unknown>, key: string): boolean {
  const v = o[key];
  if (typeof v !== "boolean") throw new IpcResponseError(method, `"${key}" must be a boolean`);
  return v;
}

function arr(method: string, v: unknown): unknown[] {
  if (!Array.isArray(v)) throw new IpcResponseError(method, "expected an array");
  return v;
}

/** `{ reply?: string } & Record<string, unknown>` — result of `agent.invoke`. */
export function validateAgentInvoke(
  method: string,
  v: unknown,
): { reply?: string } & Record<string, unknown> {
  const o = record(method, v);
  if (o["reply"] !== undefined && typeof o["reply"] !== "string") {
    throw new IpcResponseError(method, `"reply" must be a string when present`);
  }
  return o as { reply?: string } & Record<string, unknown>;
}

/** `{ ok: boolean }` — result of `engine.cancelStream`. */
export function validateOk(method: string, v: unknown): { ok: boolean } {
  const o = record(method, v);
  return { ok: bool(method, o, "ok") };
}

export function validateSessionTranscript(method: string, v: unknown): SessionTranscript {
  const o = record(method, v);
  const turns = arr(method, o["turns"]).map((t) => {
    const to = record(method, t);
    const role = str(method, to, "role");
    if (role !== "user" && role !== "assistant") {
      throw new IpcResponseError(method, `turn "role" must be "user" or "assistant"`);
    }
    const turn: SessionTranscript["turns"][number] = {
      role,
      text: str(method, to, "text"),
      timestamp: num(method, to, "timestamp"),
    };
    if (to["auditLogId"] !== undefined) turn.auditLogId = num(method, to, "auditLogId");
    return turn;
  });
  return { sessionId: str(method, o, "sessionId"), turns, hasMore: bool(method, o, "hasMore") };
}

export function validateQueryItems(
  method: string,
  v: unknown,
): { items: Record<string, unknown>[]; meta: { limit: number; total: number } } {
  const o = record(method, v);
  const items = arr(method, o["items"]).map((it) => record(method, it));
  const meta = record(method, o["meta"]);
  return { items, meta: { limit: num(method, meta, "limit"), total: num(method, meta, "total") } };
}

export function validateRankedItems(method: string, v: unknown): RankedSearchItem[] {
  return arr(method, v).map((it) => {
    const o = record(method, it);
    // Validate the ranking fields this client adds on top of NimbusItem.
    num(method, o, "score");
    str(method, o, "indexPrimaryKey");
    str(method, o, "indexedType");
    return o as unknown as RankedSearchItem;
  });
}

export function validateQuerySql(method: string, v: unknown): { rows: Record<string, unknown>[] } {
  const o = record(method, v);
  return { rows: arr(method, o["rows"]).map((r) => record(method, r)) };
}

export function validateAuditList(method: string, v: unknown): unknown[] {
  return arr(method, v);
}

export function validateEgressHead(method: string, v: unknown): EgressHead {
  const o = record(method, v);
  return { head: str(method, o, "head"), count: num(method, o, "count") };
}

function validateEgressRow(method: string, v: unknown): EgressRow {
  const o = record(method, v);
  const sourceId = o["sourceId"];
  if (sourceId !== null && typeof sourceId !== "string") {
    throw new IpcResponseError(method, `row "sourceId" must be a string or null`);
  }
  return {
    id: num(method, o, "id"),
    timestamp: num(method, o, "timestamp"),
    sourceType: str(method, o, "sourceType"),
    sourceId,
    destination: str(method, o, "destination"),
    method: str(method, o, "method"),
    payloadSummary: str(method, o, "payloadSummary"),
    hitlStatus: str(method, o, "hitlStatus"),
    resultStatus: str(method, o, "resultStatus"),
    rowHash: str(method, o, "rowHash"),
    prevHash: str(method, o, "prevHash"),
  };
}

export function validateEgressList(method: string, v: unknown): EgressListResult {
  const o = record(method, v);
  return { rows: arr(method, o["rows"]).map((r) => validateEgressRow(method, r)) };
}

export function validateEgressVerify(method: string, v: unknown): EgressVerifyResult {
  const o = record(method, v);
  const result: EgressVerifyResult = {
    ok: bool(method, o, "ok"),
    verifiedRows: num(method, o, "verifiedRows"),
  };
  if (o["brokenAt"] !== undefined) result.brokenAt = num(method, o, "brokenAt");
  if (o["reason"] !== undefined) result.reason = str(method, o, "reason");
  return result;
}

function validateEgressCompleteness(method: string, v: unknown): EgressCompleteness {
  const o = record(method, v);
  const tier = str(method, o, "tier");
  if (tier !== "authorized-actions") {
    throw new IpcResponseError(method, `completeness "tier" must be "authorized-actions"`);
  }
  return { tier, outboundEgressEvents: num(method, o, "outboundEgressEvents") };
}

function validateEgressReceipt(method: string, v: unknown): EgressReceipt {
  const o = record(method, v);
  return {
    sigB64: str(method, o, "sigB64"),
    pubkeyB64: str(method, o, "pubkeyB64"),
    digest: str(method, o, "digest"),
  };
}

export function validateEgressProveWindow(method: string, v: unknown): EgressProveWindowResult {
  const o = record(method, v);
  const result: EgressProveWindowResult = {
    rows: arr(method, o["rows"]).map((r) => validateEgressRow(method, r)),
    completeness: validateEgressCompleteness(method, o["completeness"]),
    verify: validateEgressVerify(method, o["verify"]),
  };
  if (o["receipt"] !== undefined) result.receipt = validateEgressReceipt(method, o["receipt"]);
  return result;
}
