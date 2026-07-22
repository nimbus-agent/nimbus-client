# Fixtures

## `query-items-response.json`

The exact wire shape of an `index.queryItems` response, used by
[`../query-items-conformance.test.ts`](../query-items-conformance.test.ts) to
pin `validateQueryItems` to a response real gateway code produces.

- Captured: 2026-07-22
- Gateway source: `nimbus-agent/Nimbus` `main` @ `40007ebb` — carries #780
  (`listItems()` / `IndexedItem`), i.e. the fix Stage 0 Task 2 shipped.
- Method: the `index.queryItems` RPC handler
  (`packages/gateway/src/ipc/diagnostics-rpc.ts` `rpcIndexQueryItems`), which
  wraps `LocalIndex.listItems(...)` in `{ items, meta: { limit, total } }`.

### How it was produced, and why not `nimbus query`

The plan's Step 1 says to capture from a live gateway via `nimbus query --json`.
That was not possible: the only installed/running gateway on the capture machine
was **v0.22.0**, which predates #780 and still emits the old raw-row shape — the
exact bug this gate exists to catch. Capturing from it would have pinned the
wrong contract.

Instead the response was produced by driving the **same gateway code path** the
RPC uses — `LocalIndex.ensureSchema` → `LocalIndex.upsert` → `LocalIndex.listItems`
→ the handler's `{ items, meta }` envelope — at the `main` sha above, seeded with
synthetic, PII-free rows. The **shape** therefore comes from gateway code, not by
hand, which is the property this fixture must have. Rows use fixed `modifiedAt`
timestamps so the file is deterministic across recaptures, and cover a
representative type spread (`email`, `ci_run`, `pr`, `file`, `folder`) — including
the ops types the old coercion silently relabelled to `"file"`.

### The rule

Values may be redacted or synthetic; **keys and types are never edited**. When
the conformance test fails, re-capture from a current gateway (or re-run the
capture path against current `main`) and fix the validator to match — do not edit
this file to make the test pass.
