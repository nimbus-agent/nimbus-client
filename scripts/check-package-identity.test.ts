import { expect, test } from "bun:test";
import pkg from "../package.json";

test("package identity is standalone nimbus-client", () => {
  expect(pkg.name).toBe("@nimbus-dev/client");
  expect(pkg.version).toBe("0.5.0");
  expect(pkg.license).toBe("MIT");
  expect(pkg.repository.url).toBe("git+https://github.com/nimbus-agent/nimbus-client.git");
  expect((pkg.repository as Record<string, unknown>).directory).toBeUndefined();
  expect(pkg.dependencies["@nimbus-dev/sdk"]).toBe("^1.3.0");
});
