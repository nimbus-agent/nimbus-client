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

// `bun pm pack` / `npm pack` flatten a scoped name into the tarball filename:
// "@nimbus-dev/sdk" @ 1.3.0 -> "nimbus-dev-sdk-1.3.0.tgz". Construct it
// deterministically instead of scraping stdout (which future Bun versions may
// pollute with warnings).
export function tarballName(pkgName: string, version: string): string {
  const flat = pkgName.replace(/^@/, "").replace(/\//g, "-");
  return `${flat}-${version}.tgz`;
}

if (import.meta.main) {
  const clientRoot = process.cwd();
  const sdkDir = resolveSiblingSdk(clientRoot);
  if (!sdkDir) {
    console.error("No sibling ../nimbus-sdk checkout; cannot run integration check.");
    process.exit(1);
  }
  const sdkPkg = JSON.parse(readFileSync(join(sdkDir, "package.json"), "utf8")) as {
    name?: string;
    version?: string;
  };
  // Without this, an unpackable directory produces `nimbus-dev-sdk-undefined.tgz` and
  // the failure surfaces as an unrelated "Expected tarball not found" forty lines later.
  if (!sdkPkg.name || !sdkPkg.version) {
    console.error(
      `${sdkDir} has no packable package.json (name=${String(sdkPkg.name)}, version=${String(sdkPkg.version)}).`,
    );
    process.exit(1);
  }
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
  const tarball = join(dest, tarballName(sdkPkg.name, sdkPkg.version));
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
  pkg.dependencies[sdkPkg.name] = `file:${tarball}`;
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
