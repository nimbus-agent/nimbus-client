/**
 * @nimbus-dev/client — MIT local Gateway client (IPC).
 */

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
