import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export function resolveSiblingSdk(
  clientRoot: string,
  exists: (p: string) => boolean = existsSync,
): string | null {
  const sibling = join(dirname(clientRoot), "nimbus-sdk");
  return exists(sibling) ? sibling : null;
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
    name: string;
    version: string;
  };
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
      // dep is the published "^1.3.0" and would (correctly) fail while the dep
      // is temporarily pointed at the local tarball.
      exitCode = run(["bun", "test", "test/"]).exitCode ?? 1;
    }
  } finally {
    restore();
  }
  process.exit(exitCode);
}
