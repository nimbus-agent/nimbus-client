## Summary

<!-- What does this change and why? -->

## Checklist

- [ ] `bun run typecheck` passes
- [ ] `bun run lint` passes
- [ ] `bun run test` passes (tests added/updated for behavior changes)
- [ ] `bun run build` succeeds
- [ ] No new runtime dependency (the only runtime dep is `@nimbus-dev/sdk`, consumed as the published `^1.3.0`)
- [ ] No `any` (used `unknown` + a type guard for external/cross-boundary data)
- [ ] Exported-type changes are reflected in the Conventional Commit type (semver)
