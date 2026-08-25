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
bun run typecheck   # tsc --noEmit over tsconfig.json (src + test + scripts in one project)
bun run lint        # biome check .  (whole tree)
bun run test        # bun test
bun run build       # tsc → dist/ (JS + .d.ts + declaration maps) + bundled CJS
```

## Architecture notes

- **One runtime dependency.** `@nimbus-dev/client` declares a single runtime
  dependency, [`@nimbus-dev/sdk`](https://github.com/nimbus-agent/nimbus-sdk),
  consumed as the published `^1.6.0`. The floor is asserted in
  `scripts/check-package-identity.test.ts` — bump both together. Do not add
  another runtime dependency; if you need a helper, inline it.
- **No `any`; TypeScript strict.** Use `unknown` for data crossing a boundary and
  narrow with a type guard. Biome enforces the rules in `biome.json`, including
  `noExplicitAny` and `noConsole`. The relaxations are file-pattern scoped, not
  directory scoped: `scripts/**` relaxes `noConsole`, and `**/*.test.ts` relaxes
  `noConsole` + `noNonNullAssertion` wherever it lives. A helper under `test/`
  that is not a `*.test.ts` — `test/_fake-ipc.ts`, `test/_socket-harness.ts` —
  gets the full `src/` ruleset.
- **Validate IPC results.** `IPCClient.call<T>()` casts wire data without checking
  it; public `NimbusClient` methods must validate the result through a guard in
  `src/validate.ts` (throws `IpcResponseError`) before returning.
- **Keep the mock in sync.** `NimbusClient` and `MockClient` both
  `implements NimbusClientLike`. Change the interface when you change the public
  surface and the compiler keeps the mock honest.
- **Public surface is the `exports` map.** Changing an exported type is a
  semver-relevant change — bump accordingly (Conventional Commits drive
  release-please).

## Relationship to other repos

- [`Nimbus`](https://github.com/nimbus-agent/Nimbus) — the gateway/CLI monorepo;
  the first-party consumer of this client. It pins `@nimbus-dev/client` at **two**
  sites — `packages/cli/package.json` and the monorepo root `package.json` — and
  both have to move together.
- [`nimbus-sdk`](https://github.com/nimbus-agent/nimbus-sdk) — the sole runtime
  dependency. For local co-development against an unreleased sdk, run
  `bun run verify:sdk` (packs a sibling `../nimbus-sdk` and tests against it).
  It restores `package.json` + `bun.lock` and reinstalls the published sdk itself,
  in a `finally` — every path that rewrote them is covered, and the paths that bail
  earlier (no sibling checkout, a failed sdk build or pack) never touched them. If
  that reinstall fails it says so, and a manual `bun install` is then what puts
  `node_modules` back.

## Questions

Most questions about this package turn out to be boundary questions: the method
you want isn't on `NimbusClientLike` — is that a missing wrapper here, a gateway
method that was never exposed, or a type that belongs in the sdk? From outside
the three repos above that is genuinely hard to call, and guessing wrong costs a
PR. Ask on
[Nimbus Discussions](https://github.com/nimbus-agent/Nimbus/discussions); the
gateway repo keeps that board on behalf of every repo in the list above, so a
question that spans two of them has somewhere to go. "Would you accept a PR that
does X?" belongs there too, before you write it.

When the answer is clearly *here* — a wrong type, a transport bug, a guard in
`src/validate.ts` that rejects a valid response, a `MockClient` that has drifted
from `NimbusClient` — open an issue in this repo instead and skip the board
entirely. Vulnerabilities go through [`SECURITY.md`](./SECURITY.md), never a
public thread on either.

## Pull requests

- Keep PRs focused; include tests for behavior changes.
- Use [Conventional Commits](https://www.conventionalcommits.org/) — release-please
  derives the version bump and changelog from them.
- `bun run build && bun run typecheck && bun run lint && bun test` must pass.
  **Build first.** `test/node-compat.test.ts` imports `../dist/index.js`, that path
  is inside `tsconfig.json`'s `include`, and `dist/` is gitignored — so on a fresh
  clone typecheck fails with `TS2307: Cannot find module '../dist/index.js'` until
  a build has run. This is the order CI uses (`ci.yml`), and running it the other
  way round is the usual reason a first contribution looks broken on checkout.
  CI then additionally smoke-tests the CJS bundle under Node and asserts no
  build-machine path is baked into `dist/index.cjs`; SonarCloud runs
  `bun run test:coverage` as a blocking gate.

## Releases

Releases are automated by [release-please](https://github.com/googleapis/release-please):
merged Conventional Commits open a release PR; merging it tags the release and
publishes `@nimbus-dev/client` to npm with provenance via GitHub OIDC (no
long-lived npm token).
