import { expect, test } from "bun:test";
import { dirname, join } from "node:path";
import { resolveSiblingSdk, tarballName } from "./verify-against-local-sdk.ts";

// Derive the expected sibling path with the same path.join semantics the
// implementation uses, so the assertion holds on Windows (backslash) and
// POSIX (forward-slash) alike — a hardcoded "/c/gitrep/nimbus-sdk" literal
// would fail on Windows (Non-Negotiable 5: platform equality).
const clientRoot = join("/c", "gitrep", "nimbus-client");
const siblingSdk = join(dirname(clientRoot), "nimbus-sdk");
const packablePackage = join(siblingSdk, "sdks", "typescript");

test("resolves the packable package, not the monorepo root, when one is nested", () => {
  // THE regression. The sdk checkout's root package.json is `@nimbus-dev/sdk-monorepo`:
  // private, and carrying no `version`. Returning it made `bun pm pack` fail with
  // "package.json must have `name` and `version` fields", so `verify:sdk` exited 1 on
  // every invocation and the documented pre-release integration check verified nothing.
  const exists = (p: string) => p === siblingSdk || p === packablePackage;
  expect(resolveSiblingSdk(clientRoot, exists)).toBe(packablePackage);
});

test("falls back to the checkout root when nothing is nested there", () => {
  // A pre-monorepo layout — and any future re-flattening — still resolves.
  expect(resolveSiblingSdk(clientRoot, (p) => p === siblingSdk)).toBe(siblingSdk);
});

test("returns null when sibling absent", () => {
  expect(resolveSiblingSdk(clientRoot, () => false)).toBeNull();
});

test("flattens a scoped package name into its tarball filename", () => {
  expect(tarballName("@nimbus-dev/sdk", "1.3.0")).toBe("nimbus-dev-sdk-1.3.0.tgz");
});
