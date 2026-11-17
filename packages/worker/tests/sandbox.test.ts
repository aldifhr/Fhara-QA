import { afterEach, beforeEach, describe, it, expect } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { isWithinWorkspace, resolveSandboxPath, resolveSandboxPathAsync } from "@/tools/sandbox";

const ROOT = path.resolve("./workspaces/test-project");

describe("sandbox path", () => {
  it("allows normal relative paths", () => {
    expect(resolveSandboxPath(ROOT, "app/page.tsx")).toBe(path.join(ROOT, "app/page.tsx"));
    expect(resolveSandboxPath(ROOT, "src/index.ts")).toBe(path.join(ROOT, "src/index.ts"));
    expect(resolveSandboxPath(ROOT, "file.txt")).toBe(path.join(ROOT, "file.txt"));
  });

  it("resolves ../ escapes to the requested absolute path", () => {
    // Plan 068 D14: the path sandbox is removed; `..` segments are resolved.
    expect(resolveSandboxPath(ROOT, "../secret.txt")).toBe(path.resolve(ROOT, "../secret.txt"));
    expect(resolveSandboxPath(ROOT, "app/../../secret.txt")).toBe(path.resolve(ROOT, "app/../../secret.txt"));
    expect(resolveSandboxPath(ROOT, "../../etc/passwd")).toBe(path.resolve(ROOT, "../../etc/passwd"));
  });

  it("resolves absolute paths as requested", () => {
    expect(resolveSandboxPath(ROOT, "/etc/passwd")).toBe("/etc/passwd");
    // On POSIX a Windows-style drive path is a literal, workspace-relative name.
    expect(resolveSandboxPath(ROOT, "C:\\Windows\\System32\\evil.exe")).toBe(
      path.resolve(ROOT, "C:\\Windows\\System32\\evil.exe")
    );
  });

  it("leaves backslashes literal and resolves a leading slash as absolute", () => {
    expect(resolveSandboxPath(ROOT, "app\\..\\..\\secret")).toBe(
      path.resolve(ROOT, "app\\..\\..\\secret")
    );
    expect(resolveSandboxPath(ROOT, "/app/page.tsx")).toBe("/app/page.tsx");
  });
});

describe("sandbox containment", () => {
  it("detects containment correctly", () => {
    expect(isWithinWorkspace(ROOT, path.join(ROOT, "a/b"))).toBe(true);
    expect(isWithinWorkspace(ROOT, path.resolve(ROOT, "..", "outside"))).toBe(false);
    expect(isWithinWorkspace(ROOT, ROOT)).toBe(true);
  });
});

describe("async path resolution (symlinks no longer refused)", () => {
  let root: string;
  let outside: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "fhara-sandbox-"));
    outside = await fs.mkdtemp(path.join(os.tmpdir(), "fhara-outside-"));
    await fs.mkdir(path.join(root, "src"), { recursive: true });
    await fs.writeFile(path.join(root, "src", "index.ts"), "export {};", "utf-8");
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  });

  it("resolves normal nested paths", async () => {
    const resolved = await resolveSandboxPathAsync(root, "src/index.ts");
    // No realpath: the async resolver returns the requested absolute path.
    expect(resolved).toBe(path.join(root, "src", "index.ts"));
  });

  it("resolves a symlinked directory path to the requested absolute path", async () => {
    const link = path.join(root, "escape");
    try {
      await fs.symlink(outside, link, "junction");
    } catch {
      return; // Symlink creation is not permitted on this machine.
    }
    expect(await resolveSandboxPathAsync(root, "escape/secret.txt")).toBe(
      path.join(root, "escape", "secret.txt")
    );
  });

  it("resolves a symlinked file path to the requested absolute path", async () => {
    const secret = path.join(outside, "secret.txt");
    await fs.writeFile(secret, "secret", "utf-8");
    const link = path.join(root, "secret-link.txt");
    try {
      await fs.symlink(secret, link, "file");
    } catch {
      return;
    }
    expect(await resolveSandboxPathAsync(root, "secret-link.txt")).toBe(
      path.join(root, "secret-link.txt")
    );
  });
});
