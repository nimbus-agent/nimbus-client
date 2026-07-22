import type { AgentName, BriefFor, NimbusItem } from "@nimbus-dev/sdk";

import {
  AgentBriefError,
  type AgentBriefEvent,
  type AgentParamsFor,
  AgentTimeoutError,
  DEFAULT_AGENT_TIMEOUT_MS,
  parseBriefError,
  parseBriefReady,
} from "./agents.js";
import { createAskStream } from "./ask-stream.js";
import { IPCClient } from "./ipc-transport.js";
import type { AskStreamHandle, AskStreamOptions, HitlRequest } from "./stream-events.js";
import {
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
} from "./validate.js";

export type NimbusClientOptions = {
  socketPath: string;
  /**
   * Per-request timeout in milliseconds passed to the transport. A call that
   * receives no response within this window rejects. `0` disables it.
   * Default: 30000.
   */
  requestTimeoutMs?: number;
};

/** Parameters for {@link NimbusClient.searchRanked}. */
export type RankedSearchParams = {
  /** Free-text name/title query. Empty/omitted returns the top-ranked items. */
  name?: string;
  /** Restrict results to a single connector/service id. */
  service?: string;
  /** Restrict results to a single item type (e.g. "file", "email"). */
  itemType?: string;
  /** Max results. The Gateway clamps to 1..500; default 20. */
  limit?: number;
  /** Blend semantic (vector) ranking with keyword search. Defaults to true on the Gateway. */
  semantic?: boolean;
  /** Neighbouring chunks to include per hit. The Gateway clamps to 0..8; default 2. */
  contextChunks?: number;
};

/**
 * An indexed item as `index.queryItems` returns it: a NimbusItem plus the
 * gateway's composite index key (`service:external_id`). `NimbusItem.id` is the
 * bare external id and is not unique across services, so use `indexPrimaryKey`
 * for identity. Mirrors {@link RankedSearchItem}.
 */
export type IndexedItem = NimbusItem & { indexPrimaryKey: string };

/**
 * A ranked index hit: a {@link NimbusItem} enriched with ranking metadata.
 * Mirrors the Gateway's `index.searchRanked` result shape.
 */
export type RankedSearchItem = NimbusItem & {
  score: number;
  indexPrimaryKey: string;
  indexedType: string;
  canonicalUrl?: string;
  duplicates?: readonly string[];
  semanticSnippet?: string;
  bm25Rank?: number | null;
  vectorRank?: number | null;
};

export type SessionTranscript = {
  sessionId: string;
  turns: Array<{
    role: "user" | "assistant";
    text: string;
    timestamp: number;
    auditLogId?: number;
  }>;
  hasMore: boolean;
};

/**
 * A single row of the append-only, BLAKE3-chained egress ledger.
 * Mirrors the Gateway's `EgressRow` shape (`egress/egress-verify.ts`).
 * The ledger records every gated outbound action before it dispatches.
 */
export type EgressRow = {
  id: number;
  timestamp: number;
  sourceType: string;
  sourceId: string | null;
  /** `serviceOf()` prefix of the action type — never a raw URL. */
  destination: string;
  method: string;
  /** Redacted, ≤256-byte debugging summary — NOT a security boundary. */
  payloadSummary: string;
  /** `"approved" | "not_required" | "rejected"`. */
  hitlStatus: string;
  /** `"authorized" | "blocked"`. */
  resultStatus: string;
  rowHash: string;
  prevHash: string;
};

/** Parameters for {@link NimbusClient.egressList}. */
export type EgressListParams = {
  /** Lower bound (inclusive) on row `timestamp`, epoch ms. */
  since?: number;
  /** Upper bound (inclusive) on row `timestamp`, epoch ms. */
  until?: number;
  /** Max rows. The Gateway clamps to 1..5000; default 1000. */
  limit?: number;
};

/** Result of {@link NimbusClient.egressList}. */
export type EgressListResult = {
  rows: EgressRow[];
};

/** Result of {@link NimbusClient.egressHead}: ledger head hash + row count. */
export type EgressHead = {
  head: string;
  count: number;
};

/**
 * Result of {@link NimbusClient.egressVerify}: an offline, timing-safe
 * BLAKE3-chain verification over the whole ledger.
 */
export type EgressVerifyResult = {
  ok: boolean;
  verifiedRows: number;
  /** Row id where the chain first broke, when `ok === false`. */
  brokenAt?: number;
  reason?: string;
};

/** Completeness tier attached to a prove-window result. */
export type EgressCompleteness = {
  tier: "authorized-actions";
  outboundEgressEvents: number;
};

/** An optional signed receipt over a prove-window (Ed25519, share keypair). */
export type EgressReceipt = {
  sigB64: string;
  pubkeyB64: string;
  digest: string;
};

/** Parameters for {@link NimbusClient.egressProveWindow}. */
export type EgressProveWindowParams = {
  /** Lower bound (inclusive) on the window, epoch ms. */
  since?: number;
  /** Upper bound (inclusive) on the window, epoch ms. */
  until?: number;
  /** When true, attach a signed `receipt` over the window digest. */
  sign?: boolean;
};

/** Result of {@link NimbusClient.egressProveWindow}. */
export type EgressProveWindowResult = {
  rows: EgressRow[];
  completeness: EgressCompleteness;
  /** Whole-ledger verify — the window claim is only sound if this is `ok`. */
  verify: EgressVerifyResult;
  receipt?: EgressReceipt;
};

/**
 * The public surface shared by {@link NimbusClient} and
 * {@link MockClient}. A consumer can type against this so the real client and
 * the in-memory stub stay interchangeable (and in sync at compile time).
 */
export interface NimbusClientLike {
  agentInvoke(
    input: string,
    options?: { stream?: boolean; sessionId?: string; agent?: string },
  ): Promise<{ reply?: string } & Record<string, unknown>>;
  askStream(input: string, opts?: AskStreamOptions): AskStreamHandle;
  subscribeHitl(handler: (req: HitlRequest) => void): { dispose(): void };
  subscribeAgentBrief<A extends AgentName>(
    agent: A,
    handler: (ev: AgentBriefEvent<A>) => void,
  ): { dispose(): void };
  getSessionTranscript(params: { sessionId: string; limit?: number }): Promise<SessionTranscript>;
  cancelStream(streamId: string): Promise<{ ok: boolean }>;
  queryItems(params: {
    services?: string[];
    types?: string[];
    sinceMs?: number;
    untilMs?: number;
    limit?: number;
  }): Promise<{ items: IndexedItem[]; meta: { limit: number; total: number } }>;
  searchRanked(params?: RankedSearchParams): Promise<RankedSearchItem[]>;
  querySql(sql: string): Promise<{ rows: Record<string, unknown>[] }>;
  auditList(limit?: number): Promise<unknown[]>;
  egressHead(): Promise<EgressHead>;
  egressList(params?: EgressListParams): Promise<EgressListResult>;
  egressVerify(): Promise<EgressVerifyResult>;
  egressProveWindow(params?: EgressProveWindowParams): Promise<EgressProveWindowResult>;
  close(): Promise<void>;
}

/**
 * Typed convenience wrapper over the Gateway JSON-RPC IPC surface.
 */
export class NimbusClient implements NimbusClientLike {
  private readonly ipc: IPCClient;

  private constructor(ipc: IPCClient) {
    this.ipc = ipc;
  }

  static async open(opts: NimbusClientOptions): Promise<NimbusClient> {
    const ipc = new IPCClient(opts.socketPath, {
      ...(opts.requestTimeoutMs === undefined ? {} : { requestTimeoutMs: opts.requestTimeoutMs }),
    });
    await ipc.connect();
    return new NimbusClient(ipc);
  }

  async agentInvoke(
    input: string,
    options?: { stream?: boolean; sessionId?: string; agent?: string },
  ): Promise<{ reply?: string } & Record<string, unknown>> {
    const raw = await this.ipc.call("agent.invoke", {
      input,
      stream: options?.stream ?? false,
      ...(options?.sessionId === undefined ? {} : { sessionId: options.sessionId }),
      ...(options?.agent === undefined ? {} : { agent: options.agent }),
    });
    return validateAgentInvoke("agent.invoke", raw);
  }

  askStream(input: string, opts?: AskStreamOptions): AskStreamHandle {
    return createAskStream(this.ipc, input, opts);
  }

  subscribeHitl(handler: (req: HitlRequest) => void): { dispose(): void } {
    const onBatch = (params: unknown): void => {
      if (typeof params !== "object" || params === null) return;
      const p = params as Record<string, unknown>;
      if (typeof p["requestId"] !== "string" || typeof p["prompt"] !== "string") return;
      const req: HitlRequest =
        typeof p["streamId"] === "string"
          ? {
              requestId: p["requestId"],
              prompt: p["prompt"],
              details: p["details"],
              streamId: p["streamId"],
            }
          : { requestId: p["requestId"], prompt: p["prompt"], details: p["details"] };
      handler(req);
    };
    this.ipc.onNotification("agent.hitlBatch", onBatch);
    return {
      dispose: () => {
        this.ipc.offNotification("agent.hitlBatch", onBatch);
      },
    };
  }

  /**
   * Observe both completion notifications for one agent.
   *
   * Registers on `<agent>.briefReady` AND `<agent>.briefError`; `dispose()`
   * removes both. Generic over the agent NAME so a ninth agent costs one
   * `AGENT_NAMES` entry rather than a new method.
   */
  subscribeAgentBrief<A extends AgentName>(
    agent: A,
    handler: (ev: AgentBriefEvent<A>) => void,
  ): { dispose(): void } {
    const readyMethod = `${agent}.briefReady`;
    const errorMethod = `${agent}.briefError`;
    const onReady = (params: unknown): void => {
      const ev = parseBriefReady(agent, params);
      if (ev !== null) handler(ev);
    };
    const onError = (params: unknown): void => {
      const ev = parseBriefError<A>(params);
      if (ev !== null) handler(ev);
    };
    this.ipc.onNotification(readyMethod, onReady);
    this.ipc.onNotification(errorMethod, onError);
    return {
      dispose: () => {
        this.ipc.offNotification(readyMethod, onReady);
        this.ipc.offNotification(errorMethod, onError);
      },
    };
  }

  /**
   * Fire an agent and await its brief.
   *
   * Ordering matters: the gateway starts the work before the RPC response is
   * parsed (`emit-brief.ts` fires its async IIFE immediately), so we subscribe
   * FIRST and buffer anything that arrives before `sessionId` is known, then
   * drain the buffer. Without the buffer a fast agent's notification is
   * dropped; without the sessionId filter two concurrent runs swap results.
   */
  // @ts-expect-error -- unused until the eight public agentsX methods (Task 10) call it.
  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: same — wired up in Task 10.
  private async runAgent<A extends AgentName>(
    agent: A,
    params: AgentParamsFor<A>,
    opts?: { timeoutMs?: number },
  ): Promise<BriefFor<A>> {
    const timeoutMs = opts?.timeoutMs ?? DEFAULT_AGENT_TIMEOUT_MS;
    const buffered: AgentBriefEvent<A>[] = [];
    let sessionId: string | null = null;
    let deliver: ((ev: AgentBriefEvent<A>) => void) | null = null;

    const sub = this.subscribeAgentBrief(agent, (ev) => {
      if (sessionId === null) {
        buffered.push(ev);
        return;
      }
      if (ev.sessionId === sessionId) deliver?.(ev);
    });

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const method = `agents.${agent}`;
      const raw = await this.ipc.call<unknown>(method, params);
      const sid = validateAgentSession(method, raw).sessionId;
      sessionId = sid;

      const ev = await new Promise<AgentBriefEvent<A>>((resolve, reject) => {
        deliver = resolve;
        const early = buffered.find((b) => b.sessionId === sid);
        if (early !== undefined) {
          resolve(early);
          return;
        }
        timer = setTimeout(() => {
          reject(new AgentTimeoutError(agent, sid, timeoutMs));
        }, timeoutMs);
      });

      if (!ev.ok) throw new AgentBriefError(agent, ev.sessionId, ev.error);
      return ev.findings;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      sub.dispose();
    }
  }

  async getSessionTranscript(params: {
    sessionId: string;
    limit?: number;
  }): Promise<SessionTranscript> {
    const raw = await this.ipc.call("engine.getSessionTranscript", params);
    return validateSessionTranscript("engine.getSessionTranscript", raw);
  }

  async cancelStream(streamId: string): Promise<{ ok: boolean }> {
    const raw = await this.ipc.call("engine.cancelStream", { streamId });
    return validateOk("engine.cancelStream", raw);
  }

  async queryItems(params: {
    services?: string[];
    types?: string[];
    sinceMs?: number;
    untilMs?: number;
    limit?: number;
  }): Promise<{ items: IndexedItem[]; meta: { limit: number; total: number } }> {
    const raw = await this.ipc.call("index.queryItems", {
      services: params.services,
      types: params.types,
      sinceMs: params.sinceMs,
      untilMs: params.untilMs,
      limit: params.limit,
    });
    return validateQueryItems("index.queryItems", raw);
  }

  async searchRanked(params: RankedSearchParams = {}): Promise<RankedSearchItem[]> {
    const raw = await this.ipc.call("index.searchRanked", {
      name: params.name,
      service: params.service,
      itemType: params.itemType,
      limit: params.limit,
      semantic: params.semantic,
      contextChunks: params.contextChunks,
    });
    return validateRankedItems("index.searchRanked", raw);
  }

  async querySql(sql: string): Promise<{ rows: Record<string, unknown>[] }> {
    const raw = await this.ipc.call("index.querySql", { sql });
    return validateQuerySql("index.querySql", raw);
  }

  async auditList(limit?: number): Promise<unknown[]> {
    const raw = await this.ipc.call("audit.list", { limit: limit ?? 50 });
    return validateAuditList("audit.list", raw);
  }

  /** Egress ledger head hash + row count (read-only). */
  async egressHead(): Promise<EgressHead> {
    return validateEgressHead("egress.head", await this.ipc.call("egress.head"));
  }

  /** List egress-ledger rows, optionally windowed and clamped (read-only). */
  async egressList(params: EgressListParams = {}): Promise<EgressListResult> {
    const raw = await this.ipc.call("egress.list", {
      since: params.since,
      until: params.until,
      limit: params.limit,
    });
    return validateEgressList("egress.list", raw);
  }

  /** Offline, timing-safe verify of the whole egress chain (read-only). */
  async egressVerify(): Promise<EgressVerifyResult> {
    return validateEgressVerify("egress.verify", await this.ipc.call("egress.verify"));
  }

  /**
   * Prove what left the machine in a window: the rows, the completeness tier,
   * a whole-ledger verify, and — when `sign` is set — a signed receipt.
   */
  async egressProveWindow(params: EgressProveWindowParams = {}): Promise<EgressProveWindowResult> {
    const raw = await this.ipc.call("egress.proveWindow", {
      since: params.since,
      until: params.until,
      sign: params.sign,
    });
    return validateEgressProveWindow("egress.proveWindow", raw);
  }

  async close(): Promise<void> {
    await this.ipc.disconnect();
  }
}
