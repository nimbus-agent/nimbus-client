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

if (import.meta.main) {
  const clientRoot = process.cwd();
  const target = resolvePackTarget(clientRoot);
  if (typeof target === "string") {
    console.error(target);
    process.exit(1);
  }
  const sdkDir = target.dir;
  const dest = tmpdir(); // cross-platform temp dir (Non-Negotiable 5), not "/tmp"

  const run = (cmd: string[], cwd: string = clientRoot) =>
    Bun.spawnSync(cmd, { cwd, stdout: "inherit", stderr: "inherit" });

  // Build + pack the sibling sdk (before mutating this repo, so a failure here
  // leaves package.json untouched).
  if (run(["bun", "run", "build"], sdkDir).exitCode !== 0) {
    console.error("sdk build failed.");
    process.exit(1);
  }
  if (run(["bun", "pm", "pack", "--destination", dest], sdkDir).exitCode !== 0) {
    console.error("sdk pack failed.");
    process.exit(1);
  }
  const tarball = join(dest, tarballName(target.name, target.version));
  if (!existsSync(tarball)) {
    console.error(`Expected tarball not found: ${tarball}`);
    process.exit(1);
  }

  // Point the client's sdk dependency at the packed tarball and install it.
  // `bun add <tarball>` hits a DependencyLoop when the scoped name is already a
  // dependency (Bun 1.3.14), so rewrite the dep to file:<tarball> + install.
  const pkgPath = join(clientRoot, "package.json");
  const lockPath = join(clientRoot, "bun.lock");
  const originalPkg = readFileSync(pkgPath, "utf8");
  const originalLock = existsSync(lockPath) ? readFileSync(lockPath, "utf8") : null;

  const restore = () => {
    writeFileSync(pkgPath, originalPkg);
    if (originalLock !== null) writeFileSync(lockPath, originalLock);
    // Reconcile node_modules back to the published dependency.
    run(["bun", "install"]);
  };

  const pkg = JSON.parse(originalPkg) as { dependencies: Record<string, string> };
  pkg.dependencies[target.name] = `file:${tarball}`;
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

  // Never process.exit() inside the try — that would skip restore().
  let exitCode = 1;
  try {
    if (run(["bun", "install"]).exitCode !== 0) {
      // Fail loudly: do NOT fall through to `bun test`, which would silently
      // pass against the *published* sdk and report a false green.
      console.error("Installing the packed sdk failed; aborting without running tests.");
    } else {
      // Run the client's integration suite (test/) against the packed sdk —
      // NOT the repo meta-checks under scripts/, one of which asserts the sdk
      // dep is the published floor (see check-package-identity.test.ts) and would
      // (correctly) fail while the dep is temporarily pointed at the local tarball.
      // The floor is named there and nowhere else on purpose: a version literal
      // repeated in a comment is one the next bump silently leaves behind.
      exitCode = run(["bun", "test", "test/"]).exitCode ?? 1;
    }
  } finally {
    restore();
  }
  process.exit(exitCode);
}
