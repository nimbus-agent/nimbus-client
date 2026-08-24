# @nimbus-dev/client

## What this is

MIT-licensed JSON-RPC IPC client for the Nimbus Gateway (`nimbus start`). Published to npm as **`@nimbus-dev/client`**: **`import`** loads `dist/index.js` (ESM); **`require`** loads `dist/index.cjs` (bundled CommonJS).

## Install

```bash
npm install @nimbus-dev/client
```

Run `bun run build` in this package before publishing (`prepublishOnly` does this automatically).

## Quickstart

```typescript
import { NimbusClient, IPCClient, discoverSocketPath } from "@nimbus-dev/client";

// Resolves the running gateway's endpoint: the `gateway.json` state file first,
// else the per-platform default (`\\.\pipe\nimbus-gateway` on Windows,
// `$TMPDIR/nimbus-gateway.sock` on macOS, `$XDG_RUNTIME_DIR/nimbus-gateway.sock`
// on Linux).
const { socketPath } = await discoverSocketPath();

const client = await NimbusClient.open({
  socketPath,
  requestTimeoutMs: 30_000, // optional; per-request timeout, 0 disables. Default 30s.
});
const out = await client.queryItems({ services: ["github"], limit: 10 });
await client.close();
```

To point at a specific socket instead, pass it as an override — e.g. a gateway
relocated with `NIMBUS_GATEWAY_SOCKET`, which this client does not read (only the
`gateway.json` state file records that relocation, so a missing or stale state
file leaves discovery on the platform default):

```typescript
const { socketPath } = await discoverSocketPath({ override: "/tmp/nimbus-gateway.sock" });
```

`NimbusClient` and `MockClient` both implement `NimbusClientLike`, so you can type
against the interface and swap the in-memory `MockClient` into unit tests when no
Gateway process is available.

### What's exposed

`NimbusClientLike` (see [`src/index.ts`](./src/index.ts) for every exported type)
covers these gateway namespaces:

| Namespace | Methods |
| --- | --- |
| Ask / agents | `agentInvoke`, the nine briefs (`agentsExpert`, `agentsImpact`, `agentsCatchup`, `agentsGhost`, `agentsConflicts`, `agentsHuddle`, `agentsJanitor`, `agentsPreflight`, `agentsWhy`) + `agentsWhyPeek` |
| Index & search | `queryItems`, `searchRanked`, `querySql` |
| Sessions | `getSessionTranscript`, `sessionAppend`, `sessionRecall`, `sessionList`, `sessionClear` |
| Audit | `auditList`, `auditVerify`, `auditGetSummary`, `auditToolCalls` |
| Egress | `egressHead`, `egressList`, `egressVerify`, `egressProveWindow` |
| Connectors | `connectorListStatus`, `connectorStatus`, `connectorHealthHistory`, `connectorPause`, `connectorResume`, `connectorSetInterval`, `connectorSetConfig`, `connectorSync`, `connectorAuth`, `connectorAddMcp`, `connectorRemove`, `connectorReindex` |
| Workflows | `workflowList`, `workflowSave`, `workflowDelete`, `workflowListRuns`, `workflowRun`, `workflowCancel` |
| Metrics & deploy | `metricsDora`, `deployPreflight` |
| Consent | `consentRespond` |
| Diagnostics | `gatewayPing`, `diagGetVersion`, `diagSnapshot`, `indexMetrics`, `adminStatus` |

Streaming and subscriptions: `askStream` (`AskStreamHandle`), `workflowRunStream`
(`WorkflowRunStreamHandle`), `subscribeHitl` (`HitlRequest`),
`subscribeConnectorConfigChanged` (`ConnectorConfigChanged`),
`subscribeAgentBrief` (`AgentBriefEvent`), and `cancelStream`.

### Validated responses

Every `NimbusClient` method validates the Gateway's JSON-RPC result before
returning it. A malformed or version-skewed response throws an `IpcResponseError`
at the call site rather than silently returning mistyped data:

```typescript
import { IpcResponseError } from "@nimbus-dev/client";

try {
  const head = await client.egressHead();
} catch (err) {
  if (err instanceof IpcResponseError) {
    // The gateway returned a shape this client version doesn't understand.
  }
}
```

### Egress ledger (provable locality)

Read-only view of the append-only, hash-chained egress ledger — every gated
outbound action, recorded before it dispatches:

```typescript
const { head, count } = await client.egressHead();      // ledger head + row count
const { rows } = await client.egressList({ limit: 100 }); // recent rows
const proof = await client.egressProveWindow({ since: Date.now() - 3_600_000 });

// A zero is only a claim when THREE things hold: the whole-ledger verify passed, the
// window is not indeterminate, and the class you are asking about was actually being
// observed. `indeterminate` means no boot marker covers the window — nothing is known
// to have been observing, so a bare zero says nothing at all; `validate.ts` defaults
// it to `true` when the field is absent, for that reason. There is a standalone
// `egressVerify()` too, but `egressProveWindow` already carries the same whole-ledger
// verify as `proof.verify`, so asking twice proves nothing extra.
const { coverage, outboundEgressEvents, indeterminate } = proof.completeness;
const sound = proof.verify.ok && !indeterminate && outboundEgressEvents === 0;
const observed = (cls: EgressCoverageClass) => coverage[cls] !== "none";

// Scoped claim: nothing left the machine over HTTP. A class sitting at `"none"` was
// never observed by the binary that wrote this window, so the zero makes no claim
// about it — which is why the coverage check is per-class rather than a formality.
// See `EGRESS_COVERAGE_CLASSES` and `NO_EGRESS_COVERAGE`.
const noHttpEgress = sound && observed("http");

// Unqualified "nothing left this machine" is the much stronger claim, and it needs
// EVERY class observed — not just the one you happened to ask about.
const provablyLocal = sound && EGRESS_COVERAGE_CLASSES.every(observed);
```

## Publishing (maintainers)

Releases are automated by [release-please](https://github.com/googleapis/release-please).
Merged [Conventional Commits](https://www.conventionalcommits.org/) on `main` open a
release PR; merging it tags the release and triggers `.github/workflows/release.yml`,
which publishes `@nimbus-dev/client` to npm with `npm publish --provenance` via GitHub
Actions OIDC / npm **trusted-publisher**. There is **no long-lived npm token** — the
trusted-publisher binding authenticates the workflow and attaches a verifiable provenance
attestation (see [`SECURITY.md`](./SECURITY.md)).

## See also

- [Nimbus Developer Guide](https://nimbus-agent.dev/)
- [Nimbus Discussions](https://github.com/nimbus-agent/Nimbus/discussions) — the shared board; ask there when you can't tell whether something is the client's job, the gateway's or the sdk's. Already sure it's this package? [Open an issue](https://github.com/nimbus-agent/nimbus-client/issues).

## License

MIT
