import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");

/**
 * The README enumerates this package's public surface in a namespace table plus a
 * streaming/subscriptions paragraph. That enumeration is hand-maintained, and it has
 * gone stale twice in the way hand-maintained lists do: `workflowCancel` shipped in
 * 0.17.0 and `subscribeAgentBrief` before it, each in a commit that touched only
 * `src/` and `test/`. Neither omission failed anything, because nothing read the two
 * sides against each other.
 *
 * `NimbusClientLike` is the authority — it is what a consumer writes against and what
 * `mock-client.ts` implements — so this derives the expected names from the interface
 * rather than freezing a second copy of the list here. A frozen copy is the bug.
 */

/**
 * Member names declared directly on `export interface NimbusClientLike`.
 *
 * Deliberately a line-shaped scan rather than a real parser: members are declared one
 * per line at exactly two spaces of indent, JSDoc lines start with `*` or `/`, and a
 * multi-line signature (`subscribeAgentBrief<A extends AgentName>(`) still carries its
 * name on the first line. If that formatting ever changes, `has enough members to be
 * scanning the right block` below fails loudly rather than quietly matching nothing.
 */
function interfaceMembers(): string[] {
  const src = readFileSync(join(ROOT, "src", "nimbus-client.ts"), "utf8");
  const start = src.indexOf("export interface NimbusClientLike {");
  if (start === -1) throw new Error("NimbusClientLike interface not found in src/nimbus-client.ts");
  const end = src.indexOf("\n}", start);
  if (end === -1) throw new Error("NimbusClientLike interface has no closing brace");
  const names = new Set<string>();
  for (const line of src.slice(start, end).split("\n")) {
    const m = /^ {2}([a-zA-Z][a-zA-Z0-9_]*)[<(?:]/.exec(line);
    if (m?.[1] !== undefined) names.add(m[1]);
  }
  return [...names].sort();
}

test("has enough members to be scanning the right block", () => {
  // The scan is regex-shaped, so its failure mode is matching nothing and passing
  // vacuously. This is the floor that makes the assertion below mean something: a scan
  // that suddenly finds a handful is a broken scan, not a shrunken surface.
  //
  // The floor sits well below the real count on purpose — it guards the SCANNER, and a
  // number that had to be edited on every interface change would get edited without
  // being read. Don't restate today's count here either: this comment used to claim
  // "the interface had 71 members when this was written", and it has 60, so the single
  // number it carried was the only part of it that was wrong. Derive it instead
  // (`interfaceMembers().length`).
  expect(interfaceMembers().length).toBeGreaterThan(50);
});

test("README documents every public NimbusClientLike member", () => {
  const readme = readFileSync(join(ROOT, "README.md"), "utf8");
  // Anywhere in the README counts, not a specific table cell: `close` is documented in
  // a prose example rather than the namespace table, and that is fine. What this
  // forbids is a method that ships with no mention at all.
  //
  // Identifier boundaries, not `readme.includes(name)`: a substring test lets a longer
  // documented name vouch for a shorter undocumented one, which is this guard failing
  // open in the one direction it exists to catch — `egressHead` in the namespace table
  // answers for any member ending in `Head`, and `egressList` for any ending in `List`.
  // Boundaries do not put prose off-limits, and are not meant to: a member named `run`
  // is still satisfied by the word "run" in a sentence, which is the "anywhere in the
  // README counts" rule above working as intended. What they stop is one identifier
  // hiding inside another.
  const undocumented = interfaceMembers().filter(
    (name) => !new RegExp(`\\b${name.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(readme),
  );
  expect(undocumented).toEqual([]);
});

/**
 * Method names backticked inside the README's `| Namespace | Methods |` table.
 *
 * Scoped to that table rather than the whole document, because the rest of the README
 * backticks type names, options and keywords (`IpcResponseError`, `AskStreamHandle`,
 * `import`) that are correctly not interface members — a document-wide scan could not
 * tell a stale method from a documented type. Inside the Methods column every backticked
 * token is a member name, which is what makes the reverse check below decidable.
 */
function namespaceTableMethods(): string[] {
  const lines = readFileSync(join(ROOT, "README.md"), "utf8").split("\n");
  const header = lines.findIndex((l) => l.startsWith("| Namespace | Methods |"));
  if (header === -1) throw new Error("README namespace table header not found");
  const names: string[] = [];
  // +2 skips the header and the `| --- | --- |` separator.
  for (let i = header + 2; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined || !line.startsWith("|")) break;
    const methodsCell = line.split("|")[2];
    if (methodsCell === undefined) continue;
    for (const m of methodsCell.matchAll(/`([A-Za-z][A-Za-z0-9_]*)`/g)) {
      const name = m[1];
      if (name !== undefined) names.push(name);
    }
  }
  return names;
}

test("the namespace table scan finds a whole table, not a fragment", () => {
  // Same anti-vacuity floor as above, and for the same reason: a row-shaped scan fails
  // by matching nothing. Well below the real count on purpose — it guards the SCANNER,
  // so it must not need editing every time a method is documented.
  expect(namespaceTableMethods().length).toBeGreaterThan(40);
});

test("the README namespace table names no method the interface has dropped", () => {
  // The reverse of the guard above, and the direction that one structurally cannot see.
  // A REMOVED method keeps that guard green — every member that still exists is still
  // documented — while the README goes on advertising one that does not, and the first
  // report is a consumer whose code will not compile. Shrinking is not hypothetical in
  // this package: 0.16.0 had to loosen a validator because the gateway REMOVED a field
  // 0.15.x checked strictly (`tier`; see `readCoverageVector` in `src/validate.ts`). A
  // method that goes the same way leaves a row here pointing at nothing.
  const members = new Set(interfaceMembers());
  const stale = [...new Set(namespaceTableMethods())].filter((n) => !members.has(n)).sort();
  expect(stale).toEqual([]);
});
