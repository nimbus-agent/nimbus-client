# nimbus-client — Roadmap

`@nimbus-dev/client` — the typed JSON-RPC IPC wrapper every Nimbus client
consumes to talk to the local gateway.

How the repositories fit together is described at org level in
**[ECOSYSTEM.md](https://github.com/nimbus-agent/.github/blob/main/ECOSYSTEM.md)**
(`nimbus-agent/.github`) — a **live** document, not a closed record. What closed on
2026-07-24 was the *first* `Nimbus/docs/ecosystem-roadmap.md`, retired in
nimbus-agent/Nimbus#913; a different, live document has since taken that same path, so
cite it by date rather than by filename.

ECOSYSTEM.md's ownership table gives this file exactly one question: **which RPCs the
client exposes — the width of the client surface.** The order client surfaces get built
in is not ours — it lives in
[`Nimbus/docs/roadmap.md` § Client surfaces](https://github.com/nimbus-agent/Nimbus/blob/main/docs/roadmap.md#client-surfaces),
which absorbed it and says so, and ECOSYSTEM.md deliberately rules out a second
cross-surface roadmap.

## This repo's slice

- **Role:** the single typed seam over the gateway's JSON-RPC surface; the `packages/cli` and the VS Code extension consume it.
- **Released:** on npm as `@nimbus-dev/client`; see [Releases](https://github.com/nimbus-agent/nimbus-client/releases) for the current version.
- **Next here:** track the gateway's method surface as new namespaces land. The standing gap to watch is the `agents.*` namespace: the gateway serves **14** agent kinds (`Nimbus/packages/gateway/src/ipc/agents-rpc.ts`) and this client wraps **9** — `glossary`, `decisions`, `ownership`, `premortem` and `negotiate` are served upstream and not exposed here. Widening that is an sdk change first (`AGENT_NAMES`), not a client change.
