# nimbus-client — Claude Code Context

## What this is

`@nimbus-dev/client` — the **MIT-licensed, typed JSON-RPC 2.0 IPC client** for the
Nimbus Gateway. App and extension developers use it to talk to a locally-running
gateway (`nimbus start`) without hand-rolling the IPC contract. Published to npm as
`@nimbus-dev/client`; consumed by the `Nimbus` monorepo (`packages/cli`) and the
`nimbus-vscode` extension.

## Stack

- **Runtime:** Bun v1.2+ · **Language:** TypeScript 6.x strict · **Linter:** Biome
- **Single runtime dependency:** [`@nimbus-dev/sdk`](https://github.com/nimbus-agent/nimbus-sdk),
  pinned to the published `^1.3.0` (never `workspace:*` in this standalone repo).
- **No `any`** — use `unknown` for external data; strict mode is non-negotiable.

## Commands

```bash
bun run typecheck   # tsc --noEmit (strict)
bun run lint        # biome check src/
bun run build       # dist/ ESM + bundled CJS + .d.ts
bun run test        # bun test
bun run verify:sdk  # pack a sibling ../nimbus-sdk and test against it (pre-release integration)
```

## Cross-repo relationships

- [`Nimbus`](https://github.com/nimbus-agent/Nimbus) — gateway/CLI monorepo; first-party consumer.
- [`nimbus-sdk`](https://github.com/nimbus-agent/nimbus-sdk) — the sole runtime dependency.

## Notes

- Local sdk co-development uses `bun link @nimbus-dev/sdk`; a `bun install` here
  overwrites that link — relink afterward.
- GitHub-primary (`github.com/nimbus-agent/nimbus-client`); the GitLab mirror is warm-standby only.
- Releases: Conventional Commits → release-please → `npm publish --provenance` via OIDC (no npm token).
