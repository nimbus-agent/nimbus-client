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

type AgentParamsMap = {
  expert: ExpertParams;
  impact: ImpactParams;
  catchup: CatchupParams;
  ghost: GhostParams;
  conflicts: ConflictsParams;
  huddle: HuddleParams;
  janitor: JanitorParams;
  preflight: PreflightParams;
  why: WhyParams;
};

/**
 * The agents THIS CLIENT implements a method for — nine of them.
 *
 * Deliberately not `AgentName`, which is the gateway's full roster and grows without this package:
 * SDK 2.0.0 added `decisions`, `glossary` and `ownership`, and typing the dispatch over the whole
 * union made every lookup an error, because there is no `agentsDecisions()` here to look up. Adding
 * those three is a feature — methods, param and brief types, mock fixtures, a README row — not
 * something a dependency bump should perform silently.
 *
 * The narrowing tolerates ADDITIONS and still refuses REMOVALS: the assignment below stops
 * compiling if any of the nine ceases to be an `AgentName`, which is the direction that would leave
 * this client calling a gateway method that no longer exists.
 */
export type SupportedAgentName = keyof AgentParamsMap;

const _supportedAgentsAreKnownToTheSdk: (agent: SupportedAgentName) => AgentName = (agent) => agent;
void _supportedAgentsAreKnownToTheSdk;

/**
 * The same nine at RUNTIME, for callers that need to enumerate them (the conformance gate does).
 *
 * Built from an object checked with `satisfies Record<SupportedAgentName, true>` rather than written
 * as a bare array: a name added to {@link AgentParamsMap} and forgotten here fails to compile, where
 * a hand-kept array would simply be one short and every loop over it would silently skip the new
 * agent.
 */
const SUPPORTED_AGENTS = {
  expert: true,
  impact: true,
  catchup: true,
  ghost: true,
  conflicts: true,
  huddle: true,
  janitor: true,
  preflight: true,
  why: true,
} as const satisfies Record<SupportedAgentName, true>;

export const SUPPORTED_AGENT_NAMES = Object.keys(SUPPORTED_AGENTS) as readonly SupportedAgentName[];

export type AgentParamsFor<A extends SupportedAgentName> = AgentParamsMap[A];

export type AgentBriefEvent<A extends SupportedAgentName> =
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
export function parseBriefReady<A extends SupportedAgentName>(
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
export function parseBriefError<A extends SupportedAgentName>(
  params: unknown,
): AgentBriefEvent<A> | null {
  if (!isRecord(params)) return null;
  const { sessionId, error } = params;
  if (typeof sessionId !== "string" || typeof error !== "string") return null;
  return { ok: false, sessionId, error };
}
