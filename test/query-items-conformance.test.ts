import { describe, expect, test } from "bun:test";

import { KNOWN_ITEM_TYPES } from "@nimbus-dev/sdk";
import { validateQueryItems } from "../src/validate.ts";
import golden from "./fixtures/query-items-response.json" with { type: "json" };

/**
 * The conformance gate.
 *
 * `validateQueryItems` hand-transcribes the gateway's wire contract; nothing
 * links the two at compile time. This pins it to a response real gateway code
 * actually produced, so a shape change upstream fails here instead of silently
 * yielding undefined fields in every downstream client.
 *
 * When this fails: re-capture the fixture from a current gateway (see
 * `test/fixtures/README.md`), then fix the validator to match. Do not edit the
 * fixture by hand to make it pass.
 */
describe("index.queryItems conformance", () => {
  test("the golden response validates", () => {
    expect(() => validateQueryItems("index.queryItems", golden)).not.toThrow();
  });

  test("no required field comes back undefined", () => {
    const { items } = validateQueryItems("index.queryItems", golden);
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.id).toBeTruthy();
      expect(item.indexPrimaryKey).toBeTruthy();
      expect(item.service).toBeTruthy();
      expect(item.name).toBeTruthy();
      expect(item.itemType).toBeTruthy();
    }
  });

  test("the wire is camelCase — the gateway maps rows, it does not ship columns", () => {
    const first = (golden as { items: Record<string, unknown>[] }).items[0];
    expect(first).toBeDefined();
    const keys = Object.keys(first ?? {});
    expect(keys).toContain("itemType");
    expect(keys.filter((k) => k.includes("_"))).toEqual([]);
  });

  test("indexPrimaryKey is the composite key, not the bare id", () => {
    const { items } = validateQueryItems("index.queryItems", golden);
    for (const item of items) {
      expect(item.indexPrimaryKey).toBe(`${item.service}:${item.id}`);
    }
  });

  test("every itemType in the fixture is one this SDK knows", () => {
    const { items } = validateQueryItems("index.queryItems", golden);
    const unknown = items
      .map((i) => i.itemType)
      .filter((t) => !(KNOWN_ITEM_TYPES as readonly string[]).includes(t));
    // Not a failure of the open enum — a signal the SDK vocabulary is stale.
    expect(unknown).toEqual([]);
  });
});
