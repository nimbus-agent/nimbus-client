import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

// The sdk checkout is a monorepo: its ROOT package.json is `@nimbus-dev/sdk-monorepo`,
// `private: true` and carries no `version`, while the publishable `@nimbus-dev/sdk`
// lives one level down. Packing the root fails with "package.json must have `name` and
// `version` fields" — which is what this whole check did, on every invocation, from the
// moment the sdk was restructured. Resolve to the packable package, not the checkout.
const SDK_PACKAGE_SUBPATH = join("sdks", "typescript");

export function resolveSiblingSdk(
  clientRoot: string,
  exists: (p: string) => boolean = existsSync,
): string | null {
  const sibling = join(dirname(clientRoot), "nimbus-sdk");
  if (!exists(sibling)) return null;
  // Fall back to the checkout root so a pre-monorepo (or future flattened) layout
  // still resolves; the version guard below is what catches an unpackable result.
  const nested = join(sibling, SDK_PACKAGE_SUBPATH);
  return exists(nested) ? nested : sibling;
}

/**
 * The name+version a directory can be packed under, or an error string saying why it
 * cannot be. Split out of the entry block so the diagnostic is testable: it exists
 * precisely because an unpackable directory used to produce
 * `nimbus-dev-sdk-undefined.tgz` and surface forty lines later as an unrelated
 * "Expected tarball not found", and a message nothing asserts on is a message that
 * silently rots.
 */
export function packableIdentity(
  dir: string,
  // A parsed package.json: untrusted, and carrying arbitrary other keys.
  pkg: Readonly<Record<string, unknown>>,
): { name: string; version: string } | string {
  const rawName = pkg["name"];
  const rawVersion = pkg["version"];
  const name = typeof rawName === "string" ? rawName : "";
  const version = typeof rawVersion === "string" ? rawVersion : "";
  if (name !== "" && version !== "") return { name, version };
  return `${dir} has no packable package.json (name=${String(rawName)}, version=${String(rawVersion)}).`;
}

// `bun pm pack` / `npm pack` flatten a scoped name into the tarball filename:
// "@nimbus-dev/sdk" @ 1.3.0 -> "nimbus-dev-sdk-1.3.0.tgz". Construct it
// deterministically instead of scraping stdout (which future Bun versions may
// pollute with warnings).
export function tarballName(pkgName: string, version: string): string {
  const flat = pkgName.replace(/^@/, "").replaceAll("/", "-");
  return `${flat}-${version}.tgz`;
}

export interface PackTarget {
  readonly dir: string;
  readonly name: string;
  readonly version: string;
}

/**
 * Everything the entry block needs to know before it starts mutating this repo: which
 * directory to pack, and under what identity — or one string explaining why it cannot.
 *
 * This is one function rather than three inline steps so the whole decision is reachable
 * from a test. The previous shape put the resolution in a tested helper and the *use* of
 * it in the untestable `import.meta.main` block, which is how the resolver came to return
 * an unpackable directory for months without a single test noticing.
 */
export function resolvePackTarget(
  clientRoot: string,
  deps: {
    exists?: (p: string) => boolean;
    readPackageJson?: (dir: string) => string;
  } = {},
): PackTarget | string {
  const exists = deps.exists ?? existsSync;
  const readPackageJson =
    deps.readPackageJson ?? ((dir: string) => readFileSync(join(dir, "package.json"), "utf8"));

  const dir = resolveSiblingSdk(clientRoot, exists);
  if (dir === null) {
    return "No sibling ../nimbus-sdk checkout; cannot run integration check.";
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readPackageJson(dir));
  } catch (err) {
    // A malformed package.json used to abort with a raw SyntaxError naming no path.
    return `${dir}/package.json could not be read: ${err instanceof Error ? err.message : String(err)}`;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return `${dir}/package.json is not a JSON object.`;
  }
  const identity = packableIdentity(dir, parsed as Record<string, unknown>);
  return typeof identity === "string" ? identity : { dir, ...identity };
}

/** Everything `runVerification` touches outside its own process. */
export type VerificationEnv = {
  /** Run a command to completion. Returns its exit code; `null` if a signal killed it. */
  readonly run: (cmd: string[], cwd?: string) => number | null;
  readonly exists: (p: string) => boolean;
  readonly readFile: (p: string) => string;
  readonly writeFile: (p: string, contents: string) => void;
  /** Where `bun pm pack` drops the tarball. */
  readonly packDestination: string;
  /** Diagnostics for the operator; wired to `console.error` by the entry block. */
  readonly report: (message: string) => void;
};

/**
 * The whole `verify:sdk` sequence, minus the process it runs in.
 *
 * Extracted from the `import.meta.main` block for the same reason
 * {@link resolvePackTarget} was: the decisions that matter here are the ones
 * taken when a step FAILS, and nothing inside an entry block can be reached by a
 * test. The one that matters most is `restore()` — this script rewrites the
 * repo's own `package.json` and `bun.lock` to point at a local tarball, so a
 * path that returns without restoring leaves the developer's checkout wired to a
 * file in the temp directory. That path is the failure path, which is precisely
 * the one nobody exercises by hand.
 *
 * Returns the exit code the caller should exit with. It never calls
 * `process.exit` itself: an exit inside the `try` would skip the `finally` that
 * puts the checkout back.
 */
export function runVerification(clientRoot: string, env: VerificationEnv): number {
  const target = resolvePackTarget(clientRoot, {
    exists: env.exists,
    readPackageJson: (dir) => env.readFile(join(dir, "package.json")),
  });
  if (typeof target === "string") {
    env.report(target);
    return 1;
  }
  const sdkDir = target.dir;

  // Build + pack the sibling sdk (before mutating this repo, so a failure here
  // leaves package.json untouched).
  if (env.run(["bun", "run", "build"], sdkDir) !== 0) {
    env.report("sdk build failed.");
    return 1;
  }
  if (env.run(["bun", "pm", "pack", "--destination", env.packDestination], sdkDir) !== 0) {
    env.report("sdk pack failed.");
    return 1;
  }
  const tarball = join(env.packDestination, tarballName(target.name, target.version));
  if (!env.exists(tarball)) {
    env.report(`Expected tarball not found: ${tarball}`);
    return 1;
  }

  // Point the client's sdk dependency at the packed tarball and install it.
  // `bun add <tarball>` hits a DependencyLoop when the scoped name is already a
  // dependency (Bun 1.3.14), so rewrite the dep to file:<tarball> + install.
  const pkgPath = join(clientRoot, "package.json");
  const lockPath = join(clientRoot, "bun.lock");
  const originalPkg = env.readFile(pkgPath);
  const originalLock = env.exists(lockPath) ? env.readFile(lockPath) : null;

  const restore = (): void => {
    env.writeFile(pkgPath, originalPkg);
    if (originalLock !== null) env.writeFile(lockPath, originalLock);
    // Reconcile node_modules back to the published dependency. A failure here is
    // not cosmetic and must not be swallowed: package.json and bun.lock are back
    // on the published floor while node_modules still holds the unpacked local
    // tarball, so the next `bun test` in this checkout runs against the local sdk
    // while every file in the repo says it is running against the published one.
    // Silence leaves a checkout that LOOKS restored. The exit code stays the
    // verification's own answer — this is a diagnostic about the machine, not a
    // verdict on the sdk.
    if (env.run(["bun", "install"]) !== 0) {
      env.report(
        "Restored package.json and bun.lock, but reinstalling the published sdk failed — " +
          "node_modules may still hold the packed tarball. Run `bun install` before trusting " +
          "another test run here.",
      );
    }
  };

  const pkg = JSON.parse(originalPkg) as { dependencies: Record<string, string> };
  pkg.dependencies[target.name] = `file:${tarball}`;
  env.writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

  // Never return from inside the try — that would skip restore().
  let exitCode = 1;
  try {
    if (env.run(["bun", "install"]) !== 0) {
      // Fail loudly: do NOT fall through to `bun test`, which would silently
      // pass against the *published* sdk and report a false green.
      env.report("Installing the packed sdk failed; aborting without running tests.");
    } else {
      // Run the client's integration suite (test/) against the packed sdk —
      // NOT the repo meta-checks under scripts/, one of which asserts the sdk
      // dep is the published floor (see check-package-identity.test.ts) and would
      // (correctly) fail while the dep is temporarily pointed at the local tarball.
      // The floor is named there and nowhere else on purpose: a version literal
      // repeated in a comment is one the next bump silently leaves behind.
      exitCode = env.run(["bun", "test", "test/"]) ?? 1;
    }
  } finally {
    restore();
  }
  return exitCode;
}

if (import.meta.main) {
  const clientRoot = process.cwd();
  process.exit(
    runVerification(clientRoot, {
      run: (cmd, cwd = clientRoot) =>
        Bun.spawnSync(cmd, { cwd, stdout: "inherit", stderr: "inherit" }).exitCode,
      exists: existsSync,
      readFile: (p) => readFileSync(p, "utf8"),
      writeFile: (p, contents) => {
        writeFileSync(p, contents);
      },
      packDestination: tmpdir(), // cross-platform temp dir (Non-Negotiable 5), not "/tmp"
      report: (message) => {
        console.error(message);
      },
    }),
  );
}
