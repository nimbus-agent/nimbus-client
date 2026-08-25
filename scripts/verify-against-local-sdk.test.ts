import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  packableIdentity,
  realVerificationEnv,
  resolvePackTarget,
  resolveSiblingSdk,
  runVerification,
  tarballName,
  type VerificationEnv,
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

describe("runVerification — the sequence the entry block used to run inline", () => {
  const CLIENT_ROOT = join("/c", "gitrep", "nimbus-client");
  const SDK_DIR = join(dirname(CLIENT_ROOT), "nimbus-sdk", "sdks", "typescript");
  const PACK_DEST = join("/tmp-pack");
  const TARBALL = join(PACK_DEST, "nimbus-dev-sdk-1.16.0.tgz");
  const PKG_PATH = join(CLIENT_ROOT, "package.json");
  const LOCK_PATH = join(CLIENT_ROOT, "bun.lock");

  const ORIGINAL_PKG = `${JSON.stringify(
    { name: "@nimbus-dev/client", dependencies: { "@nimbus-dev/sdk": "^1.6.0" } },
    null,
    2,
  )}\n`;
  const ORIGINAL_LOCK = '{"lockfileVersion":1}\n';

  type Harness = {
    env: VerificationEnv;
    /** Every command run, in order, as a joined string. */
    commands: string[];
    /** Current contents of the two files the script rewrites. */
    files: Map<string, string>;
    /** Every write, in order — so a mid-run state is observable after restore. */
    writes: { path: string; contents: string }[];
    reports: string[];
  };

  /**
   * `exitCodes` maps a joined command to the code it should return; anything not
   * named succeeds. `missing` names paths that must report as absent.
   */
  function harness(opts: {
    exitCodes?: Record<string, number | null>;
    missing?: string[];
    noLockfile?: boolean;
  }): Harness {
    const commands: string[] = [];
    const reports: string[] = [];
    const writes: { path: string; contents: string }[] = [];
    const files = new Map<string, string>([
      [PKG_PATH, ORIGINAL_PKG],
      [
        join(SDK_DIR, "package.json"),
        JSON.stringify({ name: "@nimbus-dev/sdk", version: "1.16.0" }),
      ],
    ]);
    if (opts.noLockfile !== true) files.set(LOCK_PATH, ORIGINAL_LOCK);

    const present = new Set<string>([
      join(dirname(CLIENT_ROOT), "nimbus-sdk"),
      SDK_DIR,
      TARBALL,
      ...files.keys(),
    ]);
    for (const p of opts.missing ?? []) present.delete(p);

    const env: VerificationEnv = {
      run: (cmd) => {
        const key = cmd.join(" ");
        commands.push(key);
        // NOT `?? 0`: a mapped `null` (a signalled process) must survive as null.
        const code = opts.exitCodes?.[key];
        return code === undefined ? 0 : code;
      },
      exists: (p) => present.has(p),
      readFile: (p) => {
        const v = files.get(p);
        if (v === undefined) throw new Error(`ENOENT: ${p}`);
        return v;
      },
      writeFile: (p, contents) => {
        writes.push({ path: p, contents });
        files.set(p, contents);
      },
      packDestination: PACK_DEST,
      report: (m) => reports.push(m),
    };
    return { env, commands, files, writes, reports };
  }

  test("happy path: packs, repoints the dependency, tests, then restores", () => {
    const h = harness({});
    expect(runVerification(CLIENT_ROOT, h.env)).toBe(0);

    expect(h.commands).toEqual([
      "bun run build",
      `bun pm pack --destination ${PACK_DEST}`,
      "bun install",
      "bun test test/",
      "bun install",
    ]);
    // The dependency really was pointed at the packed tarball before installing.
    const repointed = h.writes[0];
    expect(repointed?.path).toBe(PKG_PATH);
    expect(JSON.parse(repointed?.contents ?? "{}")).toMatchObject({
      dependencies: { "@nimbus-dev/sdk": `file:${TARBALL}` },
    });
    // …and put back byte-for-byte afterwards.
    expect(h.files.get(PKG_PATH)).toBe(ORIGINAL_PKG);
    expect(h.files.get(LOCK_PATH)).toBe(ORIGINAL_LOCK);
  });

  test("a failed install of the packed sdk restores the checkout and never runs the tests", () => {
    // The invariant this extraction exists for. Returning early here would leave
    // package.json pointing at a tarball in the temp directory; falling through
    // to `bun test` would report a green run against the PUBLISHED sdk.
    const h = harness({ exitCodes: { "bun install": 1 } });
    expect(runVerification(CLIENT_ROOT, h.env)).toBe(1);

    expect(h.commands).not.toContain("bun test test/");
    expect(h.reports).toContain(
      "Installing the packed sdk failed; aborting without running tests.",
    );
    expect(h.files.get(PKG_PATH)).toBe(ORIGINAL_PKG);
    expect(h.files.get(LOCK_PATH)).toBe(ORIGINAL_LOCK);
  });

  test("a failing test run still restores the checkout, and its exit code is reported", () => {
    const h = harness({ exitCodes: { "bun test test/": 3 } });
    expect(runVerification(CLIENT_ROOT, h.env)).toBe(3);
    expect(h.files.get(PKG_PATH)).toBe(ORIGINAL_PKG);
    // restore()'s reconciling install runs after the failing test run.
    expect(h.commands.at(-1)).toBe("bun install");
  });

  test("a test run killed by a signal is a failure, not a success", () => {
    // Bun reports a signalled process as exitCode null; `?? 1` must not become 0.
    const h = harness({ exitCodes: { "bun test test/": null } });
    expect(runVerification(CLIENT_ROOT, h.env)).toBe(1);
  });

  test("restores package.json alone when the repo has no lockfile", () => {
    const h = harness({ noLockfile: true });
    expect(runVerification(CLIENT_ROOT, h.env)).toBe(0);
    expect(h.writes.some((w) => w.path === LOCK_PATH)).toBe(false);
  });

  test("a failed sdk build stops before anything in this repo is touched", () => {
    const h = harness({ exitCodes: { "bun run build": 1 } });
    expect(runVerification(CLIENT_ROOT, h.env)).toBe(1);
    expect(h.reports).toEqual(["sdk build failed."]);
    expect(h.writes).toEqual([]);
  });

  test("a failed pack stops before anything in this repo is touched", () => {
    const h = harness({ exitCodes: { [`bun pm pack --destination ${PACK_DEST}`]: 1 } });
    expect(runVerification(CLIENT_ROOT, h.env)).toBe(1);
    expect(h.reports).toEqual(["sdk pack failed."]);
    expect(h.writes).toEqual([]);
  });

  test("a missing tarball names the path it expected, and touches nothing", () => {
    const h = harness({ missing: [TARBALL] });
    expect(runVerification(CLIENT_ROOT, h.env)).toBe(1);
    expect(h.reports).toEqual([`Expected tarball not found: ${TARBALL}`]);
    expect(h.writes).toEqual([]);
  });

  test("a failed RESTORE install is reported, not swallowed", () => {
    // Both `bun install` calls are the same command string, so the shared harness
    // cannot tell them apart — wrap it and fail only the SECOND, which is
    // restore()'s reconciling install. That one used to have its exit code
    // dropped on the floor: package.json back on the published floor,
    // node_modules still holding the unpacked tarball, and a silent exit 0. The
    // next `bun test` in the checkout then runs against the local sdk while every
    // file in the repo says otherwise.
    const h = harness({});
    let installs = 0;
    const env: VerificationEnv = {
      ...h.env,
      run: (cmd, cwd) => {
        const code = h.env.run(cmd, cwd);
        return cmd.join(" ") === "bun install" && ++installs === 2 ? 1 : code;
      },
    };

    // The verification itself passed, so the exit code stays 0 — a failed
    // reconcile is a diagnostic about this machine, not a verdict on the sdk.
    expect(runVerification(CLIENT_ROOT, env)).toBe(0);
    expect(h.reports.some((r) => r.includes("reinstalling the published sdk failed"))).toBe(true);
    // The files really were restored; only node_modules is suspect.
    expect(h.files.get(PKG_PATH)).toBe(ORIGINAL_PKG);
    expect(h.files.get(LOCK_PATH)).toBe(ORIGINAL_LOCK);
  });

  test("an unresolvable sdk checkout reports why and runs no commands", () => {
    const h = harness({ missing: [join(dirname(CLIENT_ROOT), "nimbus-sdk"), SDK_DIR] });
    expect(runVerification(CLIENT_ROOT, h.env)).toBe(1);
    expect(h.reports).toEqual(["No sibling ../nimbus-sdk checkout; cannot run integration check."]);
    expect(h.commands).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// realVerificationEnv — the process-backed wiring
// ---------------------------------------------------------------------------

/**
 * These used to live inside `import.meta.main`, where no test could reach them,
 * so every one of these properties was asserted only by the comment next to it.
 *
 * This describe owns its own temp directory and removes it itself: the file has
 * no lifecycle hooks to inherit, and a test that leaves a directory behind in
 * `tmpdir()` is a test that litters every CI run.
 */
describe("realVerificationEnv", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "nimbus-client-env-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("packs into the platform temp dir, not a hardcoded /tmp", () => {
    // Non-Negotiable 5 (platform equality): "/tmp" does not exist on Windows, so
    // a literal there would send `bun pm pack` somewhere that cannot be created.
    expect(realVerificationEnv(dir).packDestination).toBe(tmpdir());
  });

  test("exists, readFile and writeFile are wired to the real filesystem", () => {
    const env = realVerificationEnv(dir);
    const file = join(dir, "package.json");
    expect(env.exists(file)).toBe(false);
    env.writeFile(file, '{"name":"probe"}');
    expect(env.exists(file)).toBe(true);
    expect(env.readFile(file)).toBe('{"name":"probe"}');
  });

  test("run executes the command and returns its exit code", () => {
    const env = realVerificationEnv(dir);
    // `bun` is the runtime executing this test, so it is present by construction
    // on every platform this suite runs on.
    expect(env.run(["bun", "--version"])).toBe(0);
  });

  test("run surfaces a non-zero exit code rather than swallowing it", () => {
    // The whole sequence branches on this number: a step that failed must not be
    // read as a step that passed. `--eval` is spelled the same on every platform.
    expect(realVerificationEnv(dir).run(["bun", "--eval", "process.exit(3)"])).toBe(3);
  });

  test("report goes to stderr, so it never contaminates stdout", () => {
    const env = realVerificationEnv(dir);
    const original = console.error;
    const seen: unknown[] = [];
    console.error = (...args: unknown[]): void => {
      seen.push(args[0]);
    };
    try {
      env.report("something went wrong");
    } finally {
      console.error = original;
    }
    expect(seen).toEqual(["something went wrong"]);
  });
});
