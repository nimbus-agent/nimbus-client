import { describe, expect, test } from "bun:test";
import { dirname, join } from "node:path";
import {
  packableIdentity,
  resolvePackTarget,
  resolveSiblingSdk,
  tarballName,
} from "./verify-against-local-sdk.ts";

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

test("flattens EVERY separator, not just the first", () => {
  // Pins the all-occurrences semantics of the flattening step. The single-slash case
  // above passes just as happily against a first-match-only replacement, so it cannot
  // tell a global rewrite from a broken one.
  expect(tarballName("@scope/group/pkg", "0.1.0")).toBe("scope-group-pkg-0.1.0.tgz");
});

describe("packableIdentity", () => {
  test("accepts a real package", () => {
    expect(packableIdentity("/sdk", { name: "@nimbus-dev/sdk", version: "1.16.0" })).toEqual({
      name: "@nimbus-dev/sdk",
      version: "1.16.0",
    });
  });

  test("rejects the sdk monorepo root, naming what was missing", () => {
    // The exact shape that broke `verify:sdk`: a private root with a name and no version.
    const reason = packableIdentity("/sdk", { name: "@nimbus-dev/sdk-monorepo", private: true });
    expect(reason).toBe(
      "/sdk has no packable package.json (name=@nimbus-dev/sdk-monorepo, version=undefined).",
    );
  });

  test("rejects a missing name, and reports both fields either way", () => {
    expect(packableIdentity("/x", { version: "1.0.0" })).toBe(
      "/x has no packable package.json (name=undefined, version=1.0.0).",
    );
  });

  test("treats an empty string as absent rather than packing an empty name", () => {
    // `bun pm pack` rejects these too, but forty lines later and with a worse message.
    expect(typeof packableIdentity("/x", { name: "", version: "1.0.0" })).toBe("string");
    expect(typeof packableIdentity("/x", { name: "pkg", version: "" })).toBe("string");
  });

  test("treats a non-string field as absent (package.json is untrusted input)", () => {
    expect(typeof packableIdentity("/x", { name: 42, version: null })).toBe("string");
  });
});

describe("resolvePackTarget — the whole decision the entry block used to make inline", () => {
  const MONOREPO = JSON.stringify({ name: "@nimbus-dev/sdk-monorepo", private: true });
  const PACKABLE = JSON.stringify({ name: "@nimbus-dev/sdk", version: "1.16.0" });

  test("picks the nested package and reports its identity", () => {
    const target = resolvePackTarget(clientRoot, {
      exists: (p) => p === siblingSdk || p === packablePackage,
      readPackageJson: (dir) => (dir === packablePackage ? PACKABLE : MONOREPO),
    });
    expect(target).toEqual({
      dir: packablePackage,
      name: "@nimbus-dev/sdk",
      version: "1.16.0",
    });
  });

  test("explains the monorepo root instead of packing it", () => {
    // The regression end to end: sibling present, nothing nested, root unpackable.
    const target = resolvePackTarget(clientRoot, {
      exists: (p) => p === siblingSdk,
      readPackageJson: () => MONOREPO,
    });
    expect(target).toBe(
      `${siblingSdk} has no packable package.json (name=@nimbus-dev/sdk-monorepo, version=undefined).`,
    );
  });

  test("explains a missing checkout without reading anything", () => {
    let reads = 0;
    const target = resolvePackTarget(clientRoot, {
      exists: () => false,
      readPackageJson: () => {
        reads += 1;
        return PACKABLE;
      },
    });
    expect(target).toBe("No sibling ../nimbus-sdk checkout; cannot run integration check.");
    expect(reads).toBe(0);
  });

  test("names the file when its JSON is malformed, rather than throwing a bare SyntaxError", () => {
    const target = resolvePackTarget(clientRoot, {
      exists: (p) => p === siblingSdk,
      readPackageJson: () => "{ not json",
    });
    expect(target).toContain(`${siblingSdk}/package.json could not be read:`);
  });

  test("rejects valid JSON that is not an object", () => {
    // `JSON.parse("[]")` succeeds, and an array would otherwise reach the index lookups.
    for (const body of ["[]", '"a string"', "null", "7"]) {
      expect(
        resolvePackTarget(clientRoot, {
          exists: (p) => p === siblingSdk,
          readPackageJson: () => body,
        }),
      ).toBe(`${siblingSdk}/package.json is not a JSON object.`);
    }
  });

  test("surfaces a read failure as a message, not an uncaught throw", () => {
    const target = resolvePackTarget(clientRoot, {
      exists: (p) => p === siblingSdk,
      readPackageJson: () => {
        throw new Error("EACCES");
      },
    });
    expect(target).toBe(`${siblingSdk}/package.json could not be read: EACCES`);
  });
});
