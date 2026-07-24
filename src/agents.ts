/**
 * The `agents.*` namespace: nine read-only, never-HITL built-in agents.
 *
 * Each method returns `{ sessionId }` immediately, then the gateway emits
 * EITHER `<agent>.briefReady` OR `<agent>.briefError` for that session. Both
 * must be handled — watching only briefReady turns every agent failure into a
 * timeout that hides the gateway's actual error message.
 */
import { type AgentName, BRIEF_GUARDS, type BriefFor } from "@nimbus-dev/sdk";

export const DEFAULT_AGENT_TIMEOUT_MS = 30_000;

export type ExpertParams = { topicOrFile: string; limit?: number };
export type ImpactParams = {
  fileOrPrUrl: string;
  depth?: number;
  service?: string;
};
export type CatchupParams = { sinceMs?: number; service?: string };
export type GhostParams = {
  file: string;
  namespace?: string;
  namespaces?: string[];
};
export type ConflictsParams = {
  file: string;
  namespace?: string;
  namespaces?: string[];
};
export type HuddleParams = {
  sinceMs?: number;
  namespace?: string;
  namespaces?: string[];
};
export type JanitorParams = {
  resourceRef: string;
  idleDays?: number;
  cleanupAction?: string;
  allowGaps?: boolean;
};
export type PreflightParams = {
  ref: string;
  namespace: string;
  changedSurface?: string[];
};
export type WhyParams = { ref: string; line?: number };

export type AgentParamsFor<A extends AgentName> = {
  expert: ExpertParams;
  impact: ImpactParams;
  catchup: CatchupParams;
  ghost: GhostParams;
  conflicts: ConflictsParams;
  huddle: HuddleParams;
  janitor: JanitorParams;
  preflight: PreflightParams;
  why: WhyParams;
}[A];

export type AgentBriefEvent<A extends AgentName> =
  | { ok: true; sessionId: string; brief: string; findings: BriefFor<A> }
  | { ok: false; sessionId: string; error: string };

/** Thrown when the gateway emits `<agent>.briefError` for our session. */
export class AgentBriefError extends Error {
  readonly agent: AgentName;
  readonly sessionId: string;
  constructor(agent: AgentName, sessionId: string, detail: string) {
    super(`agents.${agent} failed (${sessionId}): ${detail}`);
    this.name = "AgentBriefError";
    this.agent = agent;
    this.sessionId = sessionId;
  }
}

/** Thrown when neither notification arrives within the timeout. */
export class AgentTimeoutError extends Error {
  readonly agent: AgentName;
  readonly sessionId: string;
  constructor(agent: AgentName, sessionId: string, timeoutMs: number) {
    super(`agents.${agent} did not report within ${timeoutMs}ms (${sessionId})`);
    this.name = "AgentTimeoutError";
    this.agent = agent;
    this.sessionId = sessionId;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Narrow a `<agent>.briefReady` payload, or null if it is malformed. */
export function parseBriefReady<A extends AgentName>(
  agent: A,
  params: unknown,
): AgentBriefEvent<A> | null {
  if (!isRecord(params)) return null;
  const { sessionId, brief, findings } = params;
  if (typeof sessionId !== "string" || typeof brief !== "string") return null;
  if (!BRIEF_GUARDS[agent](findings)) return null;
  return { ok: true, sessionId, brief, findings: findings as BriefFor<A> };
}

/** Narrow a `<agent>.briefError` payload, or null if it is malformed. */
export function parseBriefError<A extends AgentName>(params: unknown): AgentBriefEvent<A> | null {
  if (!isRecord(params)) return null;
  const { sessionId, error } = params;
  if (typeof sessionId !== "string" || typeof error !== "string") return null;
  return { ok: false, sessionId, error };
}
