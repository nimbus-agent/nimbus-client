/**
 * @nimbus-dev/client — MIT local Gateway client (IPC).
 */

// Re-exported so consumers (nimbus-vscode) can name the item shape without
// taking a direct dependency on @nimbus-dev/sdk.
export type { NimbusItem } from "@nimbus-dev/sdk";
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
  type EgressCompleteness,
  type EgressHead,
  type EgressListParams,
  type EgressListResult,
  type EgressProveWindowParams,
  type EgressProveWindowResult,
  type EgressReceipt,
  type EgressRow,
  type EgressVerifyResult,
  type IndexedItem,
  NimbusClient,
  type NimbusClientLike,
  type NimbusClientOptions,
  type RankedSearchItem,
  type RankedSearchParams,
  type SessionTranscript,
} from "./nimbus-client.js";
export { getNimbusPaths, type NimbusPaths } from "./paths.js";
export type {
  AskStreamHandle,
  AskStreamOptions,
  HitlRequest,
  StreamEvent,
} from "./stream-events.js";
export { IpcResponseError } from "./validate.js";
