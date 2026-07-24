# nimbus-client — Roadmap

`@nimbus-dev/client` — the typed JSON-RPC IPC wrapper every Nimbus client
consumes to talk to the local gateway.

The product roadmap lives in the gateway repo:
**[Nimbus Ecosystem Roadmap](https://github.com/nimbus-agent/Nimbus/blob/main/docs/ecosystem-roadmap.md)**
— it owns the cross-surface plan (client surfaces / delivery).

## This repo's slice

- **Role:** the single typed seam over the gateway's JSON-RPC surface; the `packages/cli` and the VS Code extension consume it.
- **Released:** on npm as `@nimbus-dev/client`; see [Releases](https://github.com/nimbus-agent/nimbus-client/releases) for the current version.
- **Next here:** track the gateway's method surface as new namespaces land.
