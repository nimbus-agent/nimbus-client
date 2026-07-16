import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";

test("ships an MIT LICENSE", () => {
  expect(existsSync("LICENSE")).toBe(true);
  expect(readFileSync("LICENSE", "utf8")).toContain("MIT License");
});
