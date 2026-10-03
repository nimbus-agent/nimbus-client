# nimbus-client — Claude Code Context

## What this is

`@nimbus-dev/client` — the **MIT-licensed, typed JSON-RPC 2.0 IPC client** for the
Nimbus Gateway. App and extension developers use it to talk to a locally-running
gateway (`nimbus start`) without hand-rolling the IPC contract. Published to npm as
`@nimbus-dev/client`; consumed by the `Nimbus` monorepo (`packages/cli`) and the
`nimbus-vscode` extension.

## Stack

- **Runtime:** Bun v1.2+ (the `engines` floor; CI, `packageManager` and `.bun-version` pin
  1.3.14) · **Language:** TypeScript 7.x strict · **Linter:** Biome
- **Single runtime dependency:** [`@nimbus-dev/sdk`](https://github.com/nimbus-agent/nimbus-sdk),
  consumed as a caret range on the published package (never `workspace:*` in this
  standalone repo). `scripts/check-package-identity.test.ts` asserts the oldest sdk
  the client works against as a FLOOR, not a copy of the range: a routine bump of
  the `package.json` range leaves it alone; raise it only when the client starts
  using a newer sdk API, and record why beside it.
- **No `any`** — use `unknown` for external data; strict mode is non-negotiable.

## Commands

```bash
bun run build          # dist/ ESM + bundled CJS + .d.ts
bun run typecheck      # tsc --noEmit over tsconfig.json (src + test + scripts in one project)
bun run lint           # biome check .  (whole tree; `**/*.test.ts` + scripts/ have rule overrides)
bun run test           # bun test
bun run test:coverage  # lcov → coverage/lcov.info; what the SonarCloud gate consumes
bun run verify:sdk     # pack the sibling ../nimbus-sdk checkout's sdks/typescript and run test/ against it
```

On a fresh clone, build first: `test/node-compat.test.ts` imports `../dist/index.js`, so
`bun run typecheck` fails with `TS2307` until `dist/` exists. CI's order is build →
typecheck → lint → test (`CONTRIBUTING.md` § Pull requests).

## Cross-repo relationships

- [`Nimbus`](https://github.com/nimbus-agent/Nimbus) — gateway/CLI monorepo; first-party consumer.
- [`nimbus-vscode`](https://github.com/nimbus-agent/nimbus-vscode) — the VS Code extension; the other consumer.
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
- GitHub only (`github.com/nimbus-agent/nimbus-client`). Unlike `Nimbus`, `nimbus-vscode`
  and `nimbus-web-clipper`, this repo has no GitLab mirror.
- Releases: Conventional Commits → release-please → `npm publish --provenance` via OIDC (no npm token).
  Squash merges keep the commit messages (`COMMIT_MESSAGES`), so local commit messages
  reach `main` — the reverse of Nimbus, where only the PR title and body survive.
- `.claude/commands/nimbus-client-boundaries.md` is this repo's skill for what is
  expensive to rediscover: consumer pins, which guards are load-bearing, gates that
  prove less than they look, and the release model.
- Dependencies: Dependabot is retired (no `.github/dependabot.yml`; alerts stay on).
  A maintainer updates dependencies in periodic bulk PRs; `CONTRIBUTING.md`
  § Updating dependencies has the steps and the rules a bulk update must respect.
  Do not re-add a Dependabot config on your own.
