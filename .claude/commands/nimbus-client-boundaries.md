---
name: nimbus-client-boundaries
description: >
  Where this package ends and the sdk, gateway and consumers begin — and which
  of its gates prove less than they look. Use when adding a `NimbusClientLike`
  method, writing or loosening a validator in `src/validate.ts`, promoting a
  gateway agent onto this surface, working out why a fresh clone fails
  typecheck, or debugging a release/publish.
---

# nimbus-client — boundaries, guards, and what the gates miss

`CLAUDE.md` and `CONTRIBUTING.md` already carry the rules: `IPCClient.call<T>` is an
unchecked cast so responses go through `src/validate.ts`; `NimbusClient` and
`MockClient` both `implements NimbusClientLike`; the sdk floor lives in
`scripts/check-package-identity.test.ts`; the release is OIDC. **Those two files
win on doctrine** — this one is the part that is expensive to rediscover: which
guard is load-bearing and which is theatre, and what a change here has to touch
in the other three repos.

## 1. A `feat` here reaches nobody on its own

Pins verified **2026-10-03**, with `0.18.0` on npm and in `.release-please-manifest.json`.
Re-derive the column before relying on it: it sat a full minor behind reality for
several releases, which is the exact failure this section exists to describe.

| Consumer | Pins | Reality |
| --- | --- | --- |
| `Nimbus` — **one site**, `packages/cli/package.json` (the root `package.json` pin was removed as unused in `nimbus-agent/Nimbus#1432`) | `^0.18.0`, lock resolves `0.18.0` | on the latest release; a caret on `0.x` is minor-locked and **cannot** cross to 0.19 |
| `nimbus-vscode` | `^0.18.0`, lock resolves `0.18.0` | on the latest release; 0.19 will not reach it either |
| `@nimbus-dev/sdk` (this package's only runtime dep) | `package.json` range `^2.0.0` (the published 0.18.0 still declares `^1.34.0`); floor `1.6.0`, asserted in `scripts/check-package-identity.test.ts` | never `workspace:*`, never add a second runtime dep |

Under `0.x` every `feat` is a **minor** bump, and a caret pin cannot cross a minor —
so publishing a method here is half the job. The follow-up PRs must bump the Nimbus pin
in `packages/cli/package.json` and the `nimbus-vscode` pin; neither consumer sees the
new minor until then.

**`engines` is a live trap.** This package declares `node >= 18`, but the sdk
declared no `engines` at 1.6.0 and `>= 22` from **1.7.0 onward** (2.0.0 included). The
declared range's minimum is well past 1.7.0, so every install resolves an sdk that
declares Node 22, and a Node 18 or 20 install reports `EBADENGINE` against the
transitive dependency. Nothing tests this — the CJS smoke runs Node 22.

**`src/paths.ts` is a third copy that has already drifted.** The other two are
`Nimbus/packages/gateway/src/platform/paths.ts` and `Nimbus/packages/cli/src/paths.ts`,
and **both of those honour `NIMBUS_GATEWAY_SOCKET`, `NIMBUS_CONFIG_DIR` and
`NIMBUS_DEMO`**. This copy honours none of them — it reads only
`APPDATA`/`LOCALAPPDATA`/`TMPDIR`/`XDG_*` — so `discoverSocketPath()` returns the
platform default for a gateway that bound elsewhere. The `gateway.json` state file
usually masks it, because discovery prefers the recorded `socketPath`; a missing or
stale state file exposes it. A demo gateway (`NIMBUS_DEMO=1`, Nimbus invariant I41) is
the case the state file cannot mask: it writes `gateway.json` under
`<dataDir>/demo/data` and binds an endpoint whose name hashes the demo root, so this
client reaches it only through an explicit `override`. Diff against both before
touching path resolution here.

## 2. Validators fail in one direction only

The asymmetry in `src/validate.ts` is the whole design (`readCoverageVector`):

- **Required field missing or mistyped → throw `IpcResponseError`.** Loud, at the
  call site.
- **Additive gateway change → absorb it.** Unknown object keys pass through; an
  unknown enum member reads as the weakest value; an unknown *class* in a vector is
  ignored.
- **Unknown means "claim nothing", never "claim the safe-sounding thing".**
  `indeterminate` defaults to `true` when absent — a gateway too old to send it is
  exactly a gateway whose coverage this client cannot vouch for.

The precedent is worth stating precisely, because the useful part is what *didn't*
happen. **0.15.x validated a scalar `tier` field strictly.** When the gateway
**removed** that field (`nimbus-agent/Nimbus#1057`), every published-client consumer
*would* have hard-failed — `nimbus-vscode` included. It never broke in the wild
only because it was pre-empted by a coordinated three-part release, of which 0.16.0
was the loosening. `src/validate.ts` still says so at the fallback:
*"Throwing instead is what 0.15.x did with `tier`."* A field **removal** is the
motivating case, not an addition, and the fix shipped ahead of the break rather than
after it.

Conformance fixtures are the counterweight to hand-transcription:
`test/query-items-conformance.test.ts` and `test/agents-conformance.test.ts` pin the
guards to payloads real gateway code produced. When one fails, **the fixture is right
and the client is wrong.**

## 3. Two surface guards, one of which is the real one

`scripts/check-readme-surface.test.ts` derives member names from the interface and
asserts each appears in `README.md`. Two details are load-bearing:

- **It matches on `\b` identifier boundaries, not `readme.includes(name)`.** A
  substring test lets a longer documented name vouch for a shorter undocumented one —
  `egressHead` in the table would answer for any member ending in `Head`, which is the
  guard failing open in the exact direction it exists for.
- **The member-count floor is the anti-vacuity assertion.** A regex scan's failure
  mode is matching nothing and passing; the floor is what makes the real assertion
  mean something. Reformat the interface and the floor fails first and loudly. Do not
  quote today's count anywhere — that comment used to name a figure that was eleven
  too high.

Anywhere in the README counts; `close` is documented only in a prose example, and that
is deliberate. The same file also checks the reverse: a method still named in the
README's `| Namespace | Methods |` table after the interface dropped it fails, because a
removal keeps the forward check green.

`test/nimbus-client-surface.test.ts` is a **second, weaker** guard: a frozen
hand-written list of prototype method names. It is the "frozen copy is the bug" shape
the README guard was written to replace. Adding a method makes the derived guard fail
and this one pass, so do not mistake its green for coverage.

**`test/_fake-ipc.ts` is a structural fake, not a typed one.** It hand-mirrors only
the `IPCClient` members the stream helpers touch (`call`, `onNotification`/`off…`,
`onClose`/`off…`, `disconnect`). Reach for a *new* `IPCClient` member from
`ask-stream.ts` or `workflow-stream.ts` and every stream test dies at runtime with
`ipc.onClose is not a function` — the comment in that file is a scar from exactly
that.

**Socket-backed tests go through `test/_socket-harness.ts`** (`tempEndpoint`,
`serveNdjson`, `serveAndCapture`, `closeTestServers`), which is built on `node:net`
because that is the one API that speaks both a POSIX unix socket and a **Windows named
pipe**. `Bun.listen({ unix })` cannot open a named pipe, and standing one up privately
is why 19 transport tests carried `test.skipIf(isWin)` — skipped on the only OS whose
CI leg exercises the named-pipe branch of `src/ipc-transport.ts` at all. They run
everywhere now; do not reintroduce a private server. `test/ipc-transport-net.test.ts`
uses the same harness to drive both `node:net` dials on every OS. Bound every wait in a
socket test the way that file's `within()` helper does: on Windows, Bun 1.3.14 can hang
the whole `bun test` run on an awaited promise that never settles instead of failing
it at the 5 s per-test timeout. It did so with nothing else keeping the event loop busy;
with sockets still open the timeout fired, and Linux fails it at 5 s either way. Windows
is a required CI leg. Note both helpers under `test/` are `_`-prefixed and are **not**
`*.test.ts`, so Biome lints them with the full `src/` ruleset (no `console`, no `!`) —
see `CLAUDE.md`.

## 4. Promoting a gateway agent onto this surface

Not "adding a tenth agent". The gateway already serves **17** kinds plus
`agents.whyPeek` (`AGENTS_RPC_HANDLERS` in `Nimbus/packages/gateway/src/ipc/agents-rpc.ts`)
and this client wraps **9**. Of the other eight, `glossary`, `decisions` and
`ownership` have been in the sdk's `AGENT_NAMES` since sdk 2.0.0, so step 1 below is
already done for them; `premortem`, `negotiate`, `changelog`, `standup` and `oncall`
are not in it. So the first question is always *is it already in `AGENT_NAMES`?* That
list is the set of brief shapes the sdk models, not the gateway's roster, so the answer
can be no for an agent that ships.

The sdk owns **four** SSoTs, not three, and the fourth is the one that bites:

1. `AGENT_NAMES`, a `BRIEF_GUARDS` entry, the `BriefFor` mapping, **and `AGENT_KIND`**
   (`nimbus-sdk` → `sdks/typescript/src/agents/agent-names.ts`). `AGENT_KIND` is **not
   derivable from the name**: every entry is the identity except `conflicts → "conflict"`,
   and `test/agents-conformance.test.ts` asserts `findings.kind === AGENT_KIND[agent]`.
   Then raise the floor asserted in `scripts/check-package-identity.test.ts` to the sdk
   release that added the agent (and the `package.json` range too, if it is still below
   that), recording the reason beside it as each past bump is. This is the "client starts
   using a newer sdk API" case that `CLAUDE.md` reserves floor bumps for.
2. Here: an entry in `AgentParamsMap` and in `SUPPORTED_AGENTS` (`src/agents.ts`). The
   latter `satisfies Record<SupportedAgentName, true>`, so forgetting it is a compile
   error, and `SupportedAgentName` wraps the map's keys in `KnownToTheSdk`, so a name
   the installed sdk does not know fails to compile; step 1 really is first. Then the
   `agentsX` method on the interface, the class and `MockClient`, an `agentBriefs`
   key, and the README row. `test/agents-conformance.test.ts` also pins, by name, the
   agents the sdk knows but this client does not implement; drop the promoted one from
   that expected list.
3. Regenerate `test/fixtures/agent-briefs.json` from the Nimbus repo
   (`bun run scripts/gen-agent-brief-fixtures.ts`), after adding the agent to that
   script's `PARAMS` table, since it emits only the agents listed there.
   `test/agents-conformance.test.ts` requires the fixture's keys to equal
   `SUPPORTED_AGENT_NAMES`, so it stays red until you do. **Never hand-edit the fixture
   to make it green** — that destroys the only link between these hand-written parsers
   and what the gateway actually emits.
   `test/fixtures/README.md` lists what the gate does *not* catch (added fields,
   `gaps[]` element shape, agent-specific composite fields).

One more string with no compile-time protection: the method name in
`test/connector-methods.test.ts` (`"connector.listStatus"`) is the only thing tying
this package to that gateway method. Nothing else in the repo catches a typo in it.

## 5. Build first — and why a fresh clone fails typecheck

`ci.yml` runs **Build → Typecheck → Lint → Test → Node CJS smoke → embedded-path
check**, and that order is not cosmetic. `test/node-compat.test.ts` carries
`typeof import("../dist/index.js")`, `tsconfig.json` includes `test/**`, and `dist/`
is gitignored — so `bun run typecheck` resolves `dist/index.d.ts` and fails
`TS2307: Cannot find module '../dist/index.js'` until a build has run.

```bash
bun run build && bun run typecheck && bun run lint && bun test
```

There is no `preflight` script. The meta-checks under `scripts/` (`check-license`,
`check-package-identity`, `check-readme-surface`, `verify-against-local-sdk`) are
ordinary `*.test.ts` files picked up by the default `bun test` glob — they are part of
the whole-suite run, not a separate command.

**`scripts/` is `sonar.sources`, and only `**/*.test.ts` is reclassified as test.** So
a non-test helper added there is analysed as production source, appears in
`coverage/lcov.info` only if a test loads it (bun instruments only what it loads), and
otherwise lands as uncovered **new code** on the PR that adds it — against a "Sonar way"
gate that requires ≥80% coverage on new code and is a required check. That is the
reason the two Node-only CI gates below are still inline in `ci.yml` rather than
extracted into a `scripts/*.cjs` a contributor could run: extracting them is a ~30-line uncoverable source file, and
the only ways to neutralise it are a coverage exclusion or an `allowJs` shim.

**All three OS legs are required on `main` here** — `build-test` on ubuntu-24.04,
macos-latest and windows-latest, plus `Analyze (javascript-typescript)`,
`SonarQube Cloud analysis` and `cla`. A Windows-only or macOS-only failure blocks. The
Nimbus monorepo gates its OS legs too, but through a single aggregator context, so a
matrix change there needs no ruleset edit; here every leg is its own required context.

Those six contexts are stored as **literal strings** in the repo's `General` ruleset,
and three of them embed the matrix value — `build-test (ubuntu-24.04)`, not a job id.
Rename the job, or move a leg to `ubuntu-latest`, and GitHub does not remap: the
required context simply never reports, and with `bypass_actors: []` the PR is stuck
pending rather than red. Editing the `os:` matrix or the job name in `ci.yml` means
editing the ruleset in the same change. The ruleset also sets the strict status-check
policy, so a PR must be up to date with `main` before it can merge.

**Two CI gates have no local script** — deliberately; see the `sonar.sources` note
above. Copy the `node -e` one-liners out of `ci.yml` if you touched the build:

- the CJS require smoke, which loads `dist/index.cjs` under Node and checks four
  exports;
- **the embedded-path check**, which greps the bundle for `file:///…`. The smoke
  cannot catch a build-machine path, because it runs on the machine that baked it —
  0.7.0 shipped with `/home/runner/work/...` frozen into the artifact and threw
  `ERR_INVALID_FILE_URL_PATH` for every `require` consumer while CI stayed green.

There is no `bunfig.toml`, so `bun test --coverage` enforces **no** threshold locally.
The only coverage floor is SonarCloud's gate with `sonar.qualitygate.wait=true`, and
`SONAR_TOKEN` is a live **org** secret — the analysis really runs here, it does not
silently skip. Bun's lcov carries line and function records only, with no branch
records (`BRDA`), so the coverage Sonar gates on is line coverage; an untested branch
arm on an executed line is invisible to it. That gate is why
`test/mock-client-defaults.test.ts` exists: every `MockClient` stub reads
`this.fixtures.X ?? <default>`, and the default is a branch nothing else reaches.

## 6. Gates that prove less than they look

- **`test/node-compat.test.ts` never executes.** It is gated on `NIMBUS_GATEWAY_BIN`,
  set in no workflow and nowhere in the repo — every run reports one skip. It is the
  only test written against a real gateway process (`node:test`, importing the built
  `dist/index.js`). It used to be the only coverage of the Node-on-Unix dial as well
  (`connectUnixNode()` in `src/ipc-transport.ts`, which `connect()` picks only when
  `Bun` is undefined, i.e. never under `bun test`); `test/ipc-transport-net.test.ts`
  now calls that dial and `connectWindows()` directly, through a cast to the private
  methods, on every OS. If you enable node-compat, know its isolation is nominal: it
  sets `NIMBUS_DATA_DIR`, which appears nowhere in Nimbus source, so the spawned
  gateway uses your real data dir and real socket.
- **`src/stream-events.ts` is type-only and invisible to coverage.** No executable
  statement means no `SF:` record in lcov, so runtime logic added there ships unmeasured
  and Sonar never notices. Put runtime logic in a covered module.
- **`MockClient`'s three `subscribe*` methods are inert** — `subscribeHitl`,
  `subscribeConnectorConfigChanged` and `subscribeAgentBrief` return a working
  `dispose` and never call the handler. A downstream test asserting "my notification
  handler fired" passes vacuously against the mock. The agent methods are the honest
  exception: they *reject* without a fixture rather than fabricating a brief shape.
- **`bun run verify:sdk` was dead for the whole life of the sdk monorepo** and is worth
  knowing about even now it works. `resolveSiblingSdk` resolved `../nimbus-sdk` and read
  *that root's* `package.json` — which is `@nimbus-dev/sdk-monorepo`, `private`, **with
  no `version`** since the publishable package moved to `sdks/typescript`. `bun pm pack`
  failed on every invocation, so the documented pre-release integration check verified
  nothing. Its unit test passed throughout, because it injects the `exists` predicate:
  **the resolution logic was tested, the resolved path was not.** It now resolves the
  packable package and guards on a missing `name`/`version`. Two properties to preserve
  if you touch it: it runs `bun test test/` only (never `scripts/`, one of which
  correctly fails while the dep points at a tarball), and it restores `package.json` +
  `bun.lock` in a `finally` — so never `process.exit()` inside `runVerification`, which
  returns the exit code for the `import.meta.main` block to hand to `process.exit`.
  The failure paths are covered now (`scripts/verify-against-local-sdk.test.ts` injects
  a `VerificationEnv`), including the one that is invisible in the exit code:
  `restore()`'s reconciling `bun install` can fail, leaving `package.json` on the
  published floor while `node_modules` still holds the unpacked tarball. It reports
  that; the run still exits with the verification's own answer.
- **`test/ipc-transport.test.ts` "call() without params omits params key from the
  request" cannot fail.** Make the assignment unconditional and it stays green:
  `JSON.stringify` drops undefined-valued keys, so both versions put identical bytes on
  the wire. The `if (params !== undefined)` it guards has no observable effect. Left in
  place as documentation of intent — just do not read its green as evidence.

## 7. `dist/index.cjs` contains the sdk's TypeScript source

The two entry points are built by different tools and are not equivalent:

- `dist/index.js` (~650 B) is `tsc` output. `@nimbus-dev/sdk/ipc` stays an **external**
  import resolved at the consumer's runtime — which is why the sdk must remain a real
  `dependencies` entry.
- `dist/index.cjs` (97,574 B built here on 2026-10-03 against sdk 2.0.0 — the figure
  tracks the installed sdk, not this repo) is `bun build --bundle --conditions=bun`.
  The sdk's `bun` export condition points at `./src/**/*.ts`, so the bundle **inlines
  the sdk's source** — grep it for `nimbus-dev/sdk` and you get
  `…/src/ipc/ndjson-line-reader`, `…/src/agents/guard-factory`.

So moving the sdk (the range, or just the version the lockfile resolves) changes what
is *inside* the published CJS artifact, and any module-scope side effect in sdk
source — the `fileURLToPath(import.meta.url)` that caused 0.7.0 — gets frozen into it.
That is what the embedded-path CI step guards.

## 8. Releasing: the merge model is inverted relative to Nimbus

**Getting this backwards costs a release.** This repo is squash-only with
`squash_title = COMMIT_OR_PR_TITLE` and `squash_msg = COMMIT_MESSAGES`, so **local
commit messages survive onto `main`** and a `Release-As:` trailer must live in a
*commit message*. Nimbus is `PR_TITLE` + `PR_BODY`, where a trailer in a commit is
discarded. Exactly inverted. With a single commit release-please parses that commit's
subject; with several, the PR title.

Version arithmetic is `0.x` with `bump-minor-pre-major: true`, so the one thing worth
remembering is **`feat!` → minor, not 1.0.0** (0.15.1 → 0.16.0 for the coverage-vector
break). Tags are `client-v*`, protected by the `Protected release tags` ruleset
(`deletion`/`non_fast_forward`/`update`, **no bypass actors**). A failed release is
abandoned and superseded, never retagged.

`release.yml` publishes with **npm trusted publishing (OIDC)**:

- **Never add `NODE_AUTH_TOKEN` or an npm token.** There is no long-lived credential;
  the trusted-publisher binding authenticates the workflow and attaches provenance. The
  job preflights `ACTIONS_ID_TOKEN_REQUEST_TOKEN` and npm ≥ 11.5.1 *before* publishing,
  because npm cannot unpublish after 72 h.
- **A laptop publish is not just discouraged — it skips gates.** `prepublishOnly` runs
  only `build && typecheck && bun test`: **no lint, no CJS smoke, no embedded-path
  check** — the two gates that exist because CI once shipped a broken artifact. The
  version would also land without provenance and be unrecoverable after 72 h.
- A publish job can go red *after* a successful publish: the tarball-signature step
  retries install+audit eight times because the packument and the attestation propagate
  independently. Both have already reddened a good release (0.6.0, 0.6.1). Re-running
  will not turn it green — the version is immutable on npm. Land the fix and cut the
  next version.
