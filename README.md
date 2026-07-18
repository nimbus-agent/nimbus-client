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
import { NimbusClient, IPCClient } from "@nimbus-dev/client";

const client = await NimbusClient.open({
  socketPath: "/tmp/nimbus-gateway.sock",
  requestTimeoutMs: 30_000, // optional; per-request timeout, 0 disables. Default 30s.
});
const out = await client.queryItems({ services: ["github"], limit: 10 });
await client.close();
```

`NimbusClient` and `MockClient` both implement `NimbusClientLike`, so you can type
against the interface and swap the in-memory `MockClient` into unit tests when no
Gateway process is available.

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
const verify = await client.egressVerify();               // offline chain verify
const proof = await client.egressProveWindow({ since: Date.now() - 3_600_000 });
// Trust `completeness` only when the whole-ledger verify passed:
// proof.verify.ok && proof.completeness.outboundEgressEvents === 0 → nothing left the machine
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

## License

MIT
