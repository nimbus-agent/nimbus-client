# nimbus-client — Roadmap

`@nimbus-dev/client` — the typed JSON-RPC IPC wrapper every Nimbus client
consumes to talk to the local gateway.

Historical context for how this client's surface was sequenced lives in the
gateway repo's
**[ECOSYSTEM.md](https://github.com/nimbus-agent/.github/blob/main/ECOSYSTEM.md)**
(closed 2026-07-24 — kept as the record of *why* the work was ordered that way,
not as a live plan). Live planning for this repo lives here.

## This repo's slice

- **Role:** the single typed seam over the gateway's JSON-RPC surface; the `packages/cli` and the VS Code extension consume it.
- **Released:** on npm as `@nimbus-dev/client`; see [Releases](https://github.com/nimbus-agent/nimbus-client/releases) for the current version.
- **Next here:** track the gateway's method surface as new namespaces land, and own the cross-surface plan (client surfaces / delivery) that the ecosystem roadmap used to sequence.
