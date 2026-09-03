import { expect, test } from "bun:test";
import manifest from "../.release-please-manifest.json";
import pkg from "../package.json";

/**
 * The comparable minimum of a `^x.y.z` range.
 *
 * Only the caret form is accepted: this repo pins its one runtime dependency that way, and a
 * parser that quietly returned 0 for a shape it did not understand would turn this floor into
 * a test that cannot fail.
 */
function caretFloor(range: string): number {
  const m = /^\^(\d+)\.(\d+)\.(\d+)$/.exec(range);
  if (m === null) throw new Error(`not a caret range: ${range}`);
  return Number(m[1]) * 1_000_000 + Number(m[2]) * 1_000 + Number(m[3]);
}

test("package identity is standalone nimbus-client", () => {
  expect(pkg.name).toBe("@nimbus-dev/client");
  expect(pkg.license).toBe("MIT");
  expect(pkg.repository.url).toBe("git+https://github.com/nimbus-agent/nimbus-client.git");
  expect((pkg.repository as Record<string, unknown>)["directory"]).toBeUndefined();
  // 1.6.0 is the floor, not a preference. 1.5.0 added BriefFor and BRIEF_GUARDS
  // for the agents namespace; 1.5.1 stopped the SDK resolving a path from
  // import.meta.url at module scope, which our CJS bundler froze into the
  // artifact — 0.7.0 shipped with the CI runner's absolute path baked in and
  // threw ERR_INVALID_FILE_URL_PATH for every `require` consumer. Dropping back
  // to 1.5.0 reintroduces that. 1.6.0 added the ninth agent, `why`
  // (`WhyBrief`/`WhyPeek`/`isWhyBrief`), which `agentsWhy`/`agentsWhyPeek` need.
  //
  // Asserted as a FLOOR, which is what the paragraph above always described. It
  // used to be `toBe("^1.6.0")`, an exact match, so every Dependabot bump of the
  // SDK failed here — the sibling test below warns against exactly that literal,
  // and this one did it anyway.
  expect(caretFloor(pkg.dependencies["@nimbus-dev/sdk"])).toBeGreaterThanOrEqual(
    caretFloor("^1.6.0"),
  );
});

test("package.json version tracks the release-please manifest baseline", () => {
  // release-please owns the version: package.json and the manifest must agree
  // so bumps stay consistent (baseline 0.4.0; first standalone release is 0.5.0
  // via a Release-As bootstrap). Asserting a hardcoded literal would break on
  // every release.
  expect(pkg.version).toBe(manifest["."]);
});
