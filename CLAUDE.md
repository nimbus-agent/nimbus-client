# nimbus-client — Claude Code Context

## What this is

`@nimbus-dev/client` — the **MIT-licensed, typed JSON-RPC 2.0 IPC client** for the
Nimbus Gateway. App and extension developers use it to talk to a locally-running
gateway (`nimbus start`) without hand-rolling the IPC contract. Published to npm as
`@nimbus-dev/client`; consumed by the `Nimbus` monorepo (`packages/cli`) and the
`nimbus-vscode` extension.

## Stack

- **Runtime:** Bun v1.2+ · **Language:** TypeScript 7.x strict · **Linter:** Biome
- **Single runtime dependency:** [`@nimbus-dev/sdk`](https://github.com/nimbus-agent/nimbus-sdk),
  consumed as a caret range on the published package (never `workspace:*` in this
  standalone repo). `scripts/check-package-identity.test.ts` asserts the oldest sdk
  the client works against as a FLOOR, not a copy of the range: a routine bump of
  the `package.json` range leaves it alone; raise it only when the client starts
  using a newer sdk API, and record why beside it.
- **No `any`** — use `unknown` for external data; strict mode is non-negotiable.

## Commands

```bash
bun run typecheck      # tsc --noEmit over tsconfig.json (src + test + scripts in one project)
bun run lint           # biome check .  (whole tree; `**/*.test.ts` + scripts/ have rule overrides)
bun run build          # dist/ ESM + bundled CJS + .d.ts
bun run test           # bun test
bun run test:coverage  # lcov → coverage/lcov.info; what the SonarCloud gate consumes
bun run verify:sdk     # pack a sibling ../nimbus-sdk and test against it (pre-release integration)
```

## Cross-repo relationships

- [`Nimbus`](https://github.com/nimbus-agent/Nimbus) — gateway/CLI monorepo; first-party consumer.
- [`nimbus-sdk`](https://github.com/nimbus-agent/nimbus-sdk) — the sole runtime dependency.

## Design invariants

- **Validate IPC results at the boundary.** `IPCClient.call<T>()` is an *unchecked*
  cast of wire data. Public `NimbusClient` methods must run the raw `unknown`
  through a guard in `src/validate.ts` (throws `IpcResponseError`) before
  returning — never hand a bare `call<T>()` result to a caller.
- **`NimbusClient` and `MockClient` both `implements NimbusClientLike`.** Adding or
  changing a public method means updating the interface; the compiler then forces
  the mock to keep pace.
- **Notification handlers must be removable.** Register via `onNotification` and
  always pair it with `offNotification` on teardown (`askStream` finish,
  `subscribeHitl().dispose()`); leaking handlers keeps dead streams firing.
- **`IPCClient.call` has a request timeout** (default 30s, `requestTimeoutMs`,
  `0` disables) so a silent gateway can't hang a caller forever.

## Notes

- Local sdk co-development uses `bun link @nimbus-dev/sdk`; a `bun install` here
  overwrites that link — relink afterward.
- Biome's test relaxations (`noConsole`, `noNonNullAssertion`) key on
  `**/*.test.ts`, **not** on `test/` — so the shared helpers `test/_fake-ipc.ts`
  and `test/_socket-harness.ts` are linted with the full `src/` ruleset, while a
  `*.test.ts` file under `src/` gets the relaxations.
- GitHub-primary (`github.com/nimbus-agent/nimbus-client`); the GitLab mirror is warm-standby only.
- Releases: Conventional Commits → release-please → `npm publish --provenance` via OIDC (no npm token).
- Dependencies: Dependabot is retired (no `.github/dependabot.yml`; alerts stay on).
  A maintainer updates dependencies in periodic bulk PRs; `CONTRIBUTING.md`
  § Updating dependencies has the steps and the rules a bulk update must respect.
  Do not re-add a Dependabot config on your own.
