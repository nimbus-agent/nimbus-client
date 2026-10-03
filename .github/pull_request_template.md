## Summary

<!-- What does this change and why? -->

## Checklist

- [ ] `bun run build` succeeds (run it first: typecheck resolves `dist/` through `test/node-compat.test.ts`)
- [ ] `bun run typecheck` passes
- [ ] `bun run lint` passes
- [ ] `bun run test` passes (tests added/updated for behavior changes)
- [ ] No new runtime dependency (the only runtime dep is `@nimbus-dev/sdk`, a caret range on the published package, never `workspace:*`; the oldest sdk the client supports is asserted as a floor in `scripts/check-package-identity.test.ts`)
- [ ] No `any` (used `unknown` + a type guard for external/cross-boundary data)
- [ ] Exported-type changes are reflected in the Conventional Commit type (semver)
