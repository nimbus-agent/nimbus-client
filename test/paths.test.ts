import { afterEach, describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";

import { getNimbusPaths } from "../src/paths.ts";

describe("getNimbusPaths", () => {
  test("returns absolute paths with stable keys", () => {
    const p = getNimbusPaths();
    expect(typeof p.configDir).toBe("string");
    expect(typeof p.dataDir).toBe("string");
    expect(typeof p.logDir).toBe("string");
    expect(typeof p.socketPath).toBe("string");
    expect(typeof p.extensionsDir).toBe("string");
    expect(p.configDir.length).toBeGreaterThan(0);
    expect(p.socketPath.length).toBeGreaterThan(0);
  });

  test("logDir is nested under dataDir", () => {
    const p = getNimbusPaths();
    expect(p.logDir.startsWith(p.dataDir)).toBe(true);
  });
});

describe("getNimbusPaths per platform", () => {
  const origPlatform = process.platform;
  const origEnv = { ...process.env };

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: origPlatform });
    process.env = { ...origEnv };
  });

  function setPlatform(p: NodeJS.Platform): void {
    Object.defineProperty(process, "platform", { value: p });
  }

  test("win32 throws when APPDATA missing", () => {
    setPlatform("win32");
    delete process.env["APPDATA"];
    process.env["LOCALAPPDATA"] = String.raw`C:\Users\u\AppData\Local`;
    expect(() => getNimbusPaths()).toThrow(/APPDATA/);
  });

  test("win32 throws when LOCALAPPDATA missing", () => {
    setPlatform("win32");
    process.env["APPDATA"] = String.raw`C:\Users\u\AppData\Roaming`;
    delete process.env["LOCALAPPDATA"];
    expect(() => getNimbusPaths()).toThrow(/LOCALAPPDATA/);
  });

  test("win32 returns named pipe socketPath", () => {
    setPlatform("win32");
    process.env["APPDATA"] = String.raw`C:\Users\u\AppData\Roaming`;
    process.env["LOCALAPPDATA"] = String.raw`C:\Users\u\AppData\Local`;
    const p = getNimbusPaths();
    expect(p.socketPath).toBe(String.raw`\\.\pipe\nimbus-gateway`);
  });

  test("darwin honors TMPDIR for socketPath", () => {
    setPlatform("darwin");
    process.env["TMPDIR"] = "/synthetic-tmpdir-test/";
    const p = getNimbusPaths();
    expect(p.socketPath).toBe("/synthetic-tmpdir-test/nimbus-gateway.sock");
  });

  // Every case above SETS the env var it is about, so the `||` fallbacks — where
  // the client actually looks on a machine with no XDG configuration, which is
  // most of them — were never taken.

  test("darwin falls back to /tmp when TMPDIR is unset", () => {
    setPlatform("darwin");
    delete process.env["TMPDIR"];
    expect(getNimbusPaths().socketPath).toBe("/tmp/nimbus-gateway.sock");
  });

  test("linux falls back to the XDG defaults when the env vars are unset", () => {
    setPlatform("linux");
    delete process.env["XDG_CONFIG_HOME"];
    delete process.env["XDG_DATA_HOME"];
    const p = getNimbusPaths();
    // joinPosix, so the separator is "/" whichever platform runs the test.
    expect(p.configDir.endsWith("/.config/nimbus")).toBe(true);
    expect(p.dataDir.endsWith("/.local/share/nimbus")).toBe(true);
    expect(p.logDir.endsWith("/.local/share/nimbus/logs")).toBe(true);
    expect(p.extensionsDir.endsWith("/.local/share/nimbus/extensions")).toBe(true);
  });

  test("linux falls back to the OS temp dir for the socket when XDG_RUNTIME_DIR is unset", () => {
    setPlatform("linux");
    delete process.env["XDG_RUNTIME_DIR"];
    const p = getNimbusPaths();
    expect(p.socketPath.startsWith(tmpdir())).toBe(true);
    expect(p.socketPath.endsWith("/nimbus-gateway.sock")).toBe(true);
  });

  test("linux honors XDG_RUNTIME_DIR", () => {
    setPlatform("linux");
    process.env["XDG_RUNTIME_DIR"] = "/run/user/1000";
    const p = getNimbusPaths();
    expect(p.socketPath).toBe("/run/user/1000/nimbus-gateway.sock");
  });
});
