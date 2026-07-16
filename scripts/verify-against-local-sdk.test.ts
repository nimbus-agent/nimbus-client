import { expect, test } from "bun:test";
import { dirname, join } from "node:path";
import { resolveSiblingSdk, tarballName } from "./verify-against-local-sdk.ts";

// Derive the expected sibling path with the same path.join semantics the
// implementation uses, so the assertion holds on Windows (backslash) and
// POSIX (forward-slash) alike — a hardcoded "/c/gitrep/nimbus-sdk" literal
// would fail on Windows (Non-Negotiable 5: platform equality).
const clientRoot = join("/c", "gitrep", "nimbus-client");
const siblingSdk = join(dirname(clientRoot), "nimbus-sdk");

test("resolves sibling nimbus-sdk when present", () => {
  expect(resolveSiblingSdk(clientRoot, (p) => p === siblingSdk)).toBe(siblingSdk);
});

test("returns null when sibling absent", () => {
  expect(resolveSiblingSdk(clientRoot, () => false)).toBeNull();
});

test("flattens a scoped package name into its tarball filename", () => {
  expect(tarballName("@nimbus-dev/sdk", "1.3.0")).toBe("nimbus-dev-sdk-1.3.0.tgz");
});
