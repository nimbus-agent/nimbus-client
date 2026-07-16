# Security Policy

`@nimbus-dev/client` is an MIT-licensed TypeScript library: a typed JSON-RPC 2.0
IPC client for talking to a locally-running Nimbus Gateway (`nimbus start`). Its
only runtime dependency is [`@nimbus-dev/sdk`](https://github.com/nimbus-agent/nimbus-sdk).
It holds no credentials of its own and makes no outbound network calls — it
speaks to the local gateway over IPC on the same machine.

## Reporting a vulnerability

Please report security issues privately rather than opening a public issue:

- Use GitHub's [private vulnerability reporting](https://github.com/nimbus-agent/nimbus-client/security/advisories/new)
  for this repository, or
- Follow the disclosure process in the main
  [Nimbus security policy](https://github.com/nimbus-agent/Nimbus/security/policy).

Please include reproduction steps and the client version. We aim to acknowledge
reports within a few business days.

## Security posture

- **Single, pinned runtime dependency.** The published package declares only
  `@nimbus-dev/sdk`, so its supply-chain surface is limited to this repo's own
  source plus that one dependency.
- **Provenance publishing.** Releases are published with `npm publish --provenance`
  via GitHub Actions OIDC / npm trusted-publisher — there is no long-lived npm
  token in repository secrets, and each release carries a verifiable attestation.
- **Local IPC only.** The client connects to a gateway process on the local
  machine. Credential handling, the HITL gate, and connector sandboxing all live
  in the [Nimbus](https://github.com/nimbus-agent/Nimbus) gateway, not here.

## Scope

Issues in the gateway, connectors, the Vault, or the HITL/consent machinery
belong in the [Nimbus](https://github.com/nimbus-agent/Nimbus) repository. Issues
in the client's own types, transport, or helpers (this repo) belong here.
