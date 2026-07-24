import { expect, test } from "bun:test";
import manifest from "../.release-please-manifest.json";
import pkg from "../package.json";

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
  expect(pkg.dependencies["@nimbus-dev/sdk"]).toBe("^1.6.0");
});

test("package.json version tracks the release-please manifest baseline", () => {
  // release-please owns the version: package.json and the manifest must agree
  // so bumps stay consistent (baseline 0.4.0; first standalone release is 0.5.0
  // via a Release-As bootstrap). Asserting a hardcoded literal would break on
  // every release.
  expect(pkg.version).toBe(manifest["."]);
});
