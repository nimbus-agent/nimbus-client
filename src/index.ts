/**
 * @nimbus-dev/client — MIT local Gateway client (IPC).
 */

// Re-exported so consumers (nimbus-vscode) can name the item shape without
// taking a direct dependency on @nimbus-dev/sdk.
export type {
  AgentBrief,
  AgentName,
  BriefFor,
  CatchupBrief,
  ConflictBrief,
  ExpertBrief,
  GhostBrief,
  HuddleBrief,
  ImpactBrief,
  JanitorBrief,
  NimbusItem,
  PreflightBrief,
} from "@nimbus-dev/sdk";
export {
  AgentBriefError,
  type AgentBriefEvent,
  type AgentParamsFor,
  AgentTimeoutError,
  type CatchupParams,
  type ConflictsParams,
  DEFAULT_AGENT_TIMEOUT_MS,
  type ExpertParams,
  type GhostParams,
  type HuddleParams,
  type ImpactParams,
  type JanitorParams,
  type PreflightParams,
} from "./agents.js";
export {
  discoverSocketPath,
  type GatewayStateFile,
  gatewayStatePath,
  readGatewayState,
  type SocketDiscoveryResult,
} from "./discovery.js";
export { IPCClient, type IPCClientOptions } from "./ipc-transport.js";
export { MockClient, type MockClientFixtures } from "./mock-client.js";
export {
  type AuditStatus,
  type AuditSummary,
  type AuditToolCallsParams,
  type AuditToolCallsResult,
  type AuditVerifyParams,
  type AuditVerifyResult,
  type ConnectorHealthEntry,
  type ConnectorStatus,
  type ConsentRespondParams,
  type DiagSnapshot,
  type DiagVersion,
  type EgressCompleteness,
  type EgressHead,
  type EgressListParams,
  type EgressListResult,
  type EgressProveWindowParams,
  type EgressProveWindowResult,
  type EgressReceipt,
  type EgressRow,
  type EgressVerifyResult,
  type GatewayPingResult,
  type GatewayStatus,
  type HitlStatusCounts,
  type IdentityStatus,
  type IndexedItem,
  type IndexMetrics,
  type NamespaceStatus,
  NimbusClient,
  type NimbusClientLike,
  type NimbusClientOptions,
  type PeerStatus,
  type PolicySource,
  type PolicyState,
  type RankedSearchItem,
  type RankedSearchParams,
  type SandboxDiag,
  type SessionTranscript,
  type ToolCallLogEntry,
  type WatcherSummary,
} from "./nimbus-client.js";
export { getNimbusPaths, type NimbusPaths } from "./paths.js";
export type {
  AskStreamHandle,
  AskStreamOptions,
  HitlRequest,
  StreamEvent,
} from "./stream-events.js";
export { IpcResponseError } from "./validate.js";
