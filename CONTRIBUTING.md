# Contributing

Thanks for helping improve the Nimbus client!

## Prerequisites

- [Bun](https://bun.sh) v1.2+

## Setup

```bash
bun install
```

## Develop

```bash
bun run typecheck   # tsc --noEmit (strict)
bun run lint        # biome check src/
bun run test        # bun test
bun run build       # tsc → dist/ (JS + .d.ts + declaration maps) + bundled CJS
```

## Architecture notes

- **One runtime dependency.** `@nimbus-dev/client` declares a single runtime
  dependency, [`@nimbus-dev/sdk`](https://github.com/nimbus-agent/nimbus-sdk),
  consumed as the published `^1.3.0`. Do not add another runtime dependency; if
  you need a helper, inline it.
- **No `any`; TypeScript strict.** Use `unknown` for data crossing a boundary and
  narrow with a type guard. Biome enforces the rules in `biome.json`, including
  `noExplicitAny` and `noConsole` in `src/`.
- **Public surface is the `exports` map.** Changing an exported type is a
  semver-relevant change — bump accordingly (Conventional Commits drive
  release-please).

## Relationship to other repos

- [`Nimbus`](https://github.com/nimbus-agent/Nimbus) — the gateway/CLI monorepo;
  the first-party consumer of this client (`packages/cli` depends on
  `@nimbus-dev/client`).
- [`nimbus-sdk`](https://github.com/nimbus-agent/nimbus-sdk) — the sole runtime
  dependency. For local co-development against an unreleased sdk, run
  `bun run verify:sdk` (packs a sibling `../nimbus-sdk` and tests against it).
  A subsequent `bun install` restores the published sdk.

## Pull requests

- Keep PRs focused; include tests for behavior changes.
- Use [Conventional Commits](https://www.conventionalcommits.org/) — release-please
  derives the version bump and changelog from them.
- `bun run typecheck && bun run lint && bun run build && bun test` must pass
  (CI runs the same on Ubuntu).

## Releases

Releases are automated by [release-please](https://github.com/googleapis/release-please):
merged Conventional Commits open a release PR; merging it tags the release and
publishes `@nimbus-dev/client` to npm with provenance via GitHub OIDC (no
long-lived npm token).
