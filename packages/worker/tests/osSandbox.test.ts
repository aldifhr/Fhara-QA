import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
  bwrapProfileArgs,
  isSandboxDenial,
  probeSandboxSupport,
  resetSandboxProbeForTest,
  resolveSandboxMode,
  sandboxCapability,
  sandboxStatus,
  SANDBOX_UNAVAILABLE,
  wrapCommand,
  writableRootsFor,
} from "@/tools/osSandbox";
import type { PtyHandle } from "@/tools/runPty";
import { runSandboxedShell } from "@/execution/shellRun";

// D6: command sandbox (bwrap). Everything here runs without bwrap: the
// probe is injected and the PTY spawn is a fake that records the argv.

let root: string;
const savedMode = process.env.SANDBOX_MODE;
const savedExtra = process.env.SANDBOX_EXTRA_WRITE_ROOTS;

beforeEach(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "fhara-d6-")));
});
afterEach(async () => {
  resetSandboxProbeForTest();
  if (savedMode === undefined) delete process.env.SANDBOX_MODE;
  else process.env.SANDBOX_MODE = savedMode;
  if (savedExtra === undefined) delete process.env.SANDBOX_EXTRA_WRITE_ROOTS;
  else process.env.SANDBOX_EXTRA_WRITE_ROOTS = savedExtra;
  await fs.rm(root, { recursive: true, force: true });
});

describe("resolveSandboxMode", () => {
  // Plan 068 D14: the OS sandbox is removed by owner decision. The fork
  // always resolves to off, explicitly, regardless of env or platform.
  it("always resolves to off when the mode is unset or blank", () => {
    expect(resolveSandboxMode({}, "linux")).toEqual({ mode: "off", explicit: true });
    expect(resolveSandboxMode({ SANDBOX_MODE: "  " }, "linux")).toEqual({ mode: "off", explicit: true });
  });

  it("ignores an explicit non-off mode", () => {
    expect(resolveSandboxMode({ SANDBOX_MODE: "off" }, "linux")).toEqual({ mode: "off", explicit: true });
    expect(resolveSandboxMode({ SANDBOX_MODE: "read-only" }, "linux")).toEqual({ mode: "off", explicit: true });
    expect(resolveSandboxMode({ SANDBOX_MODE: "workspace-write" }, "win32")).toEqual({ mode: "off", explicit: true });
  });

  it("adds no platform note on hosts without bwrap", () => {
    expect(resolveSandboxMode({}, "darwin")).toEqual({ mode: "off", explicit: true });
    expect(resolveSandboxMode({}, "linux")).toEqual({ mode: "off", explicit: true });
  });
});

describe("probe and status", () => {
  it("probes once and caches full / partial / off", () => {
    const calls: string[][] = [];
    resetSandboxProbeForTest((args) => {
      calls.push(args);
      return !args.includes("--unshare-pid");
    });
    expect(probeSandboxSupport("linux")).toBe("partial");
    expect(probeSandboxSupport("linux")).toBe("partial");
    expect(calls).toHaveLength(2); // full failed, partial passed, then cached
    resetSandboxProbeForTest(() => true);
    expect(probeSandboxSupport("linux")).toBe("full");
  });

  it("reports off (never SANDBOX_UNAVAILABLE) even when bwrap is not usable", () => {
    resetSandboxProbeForTest(() => false);
    const status = sandboxStatus({}, "linux");
    expect(status).toMatchObject({ mode: "off", support: "off", active: false, note: "sandbox off" });
    expect(status.code).toBeUndefined();
    expect(status.code).not.toBe(SANDBOX_UNAVAILABLE);
    expect(sandboxCapability(status)).toBe("sandbox:off");
    expect(sandboxStatus({ SANDBOX_MODE: "workspace-write" }, "linux").code).toBeUndefined();
  });

  it("stays off even with a working bwrap probe", () => {
    resetSandboxProbeForTest(() => true);
    const status = sandboxStatus({}, "linux");
    expect(status).toMatchObject({ mode: "off", active: false, support: "off", note: "sandbox off" });
    expect(sandboxCapability(status)).toBe("sandbox:off");
  });
});

describe("bwrapProfileArgs", () => {
  it("mounts / read-only, a private /tmp and the writable roots in workspace-write", () => {
    const args = bwrapProfileArgs({ mode: "workspace-write", writableRoots: ["/w", "/x"] });
    expect(args.slice(0, 3)).toEqual(["--ro-bind", "/", "/"]);
    expect(args).toEqual(expect.arrayContaining(["--unshare-pid", "--die-with-parent"]));
    expect(args.join(" ")).toContain("--tmpfs /tmp --bind /w /w --bind /x /x");
  });

  it("binds nothing writable in read-only and drops the PID namespace when partial", () => {
    expect(bwrapProfileArgs({ mode: "read-only", writableRoots: ["/w"] })).not.toContain("--bind");
    const partial = bwrapProfileArgs({ mode: "workspace-write", writableRoots: [] }, "partial");
    expect(partial).not.toContain("--unshare-pid");
    expect(partial).not.toContain("--proc");
  });
});

describe("wrapCommand", () => {
  it("runs as-is (unconfined) even when bwrap is unusable", () => {
    resetSandboxProbeForTest(() => false);
    const wrapped = wrapCommand("npm", ["test"], root, { env: {} });
    expect(wrapped).toMatchObject({ kind: "unconfined", reason: "off", command: "npm", args: ["test"] });
    expect(wrapped.kind === "unconfined" && wrapped.status).toMatchObject({ mode: "off", active: false });
  });

  it("never wraps the argv in bwrap, even with a working probe", () => {
    resetSandboxProbeForTest(() => true);
    const wrapped = wrapCommand("npm", ["run", "test"], root, { env: {} });
    expect(wrapped.kind).toBe("unconfined");
    if (wrapped.kind !== "unconfined") return;
    expect(wrapped.reason).toBe("off");
    expect(wrapped.command).toBe("npm");
    expect(wrapped.args).toEqual(["run", "test"]);
  });

  it("runs unconfined only when asked (after a run_unconfined approval)", () => {
    resetSandboxProbeForTest(() => true);
    expect(wrapCommand("npm", ["test"], root, { env: {}, unconfined: true })).toMatchObject({ kind: "unconfined", reason: "approved", command: "npm" });
  });
});

describe("writableRootsFor", () => {
  it("adds a linked worktree's git common dir and absolute, existing extra roots", async () => {
    const common = path.join(root, "main", ".git");
    const gitDir = path.join(common, "worktrees", "wt");
    const worktree = path.join(root, "wt");
    const extra = path.join(root, "cache");
    await fs.mkdir(gitDir, { recursive: true });
    await fs.mkdir(worktree);
    await fs.mkdir(extra);
    await fs.writeFile(path.join(gitDir, "commondir"), "../..\n");
    await fs.writeFile(path.join(worktree, ".git"), `gitdir: ${gitDir}\n`);
    const roots = writableRootsFor(worktree, { SANDBOX_EXTRA_WRITE_ROOTS: `${extra}, relative/dir, ${path.join(root, "missing")}` });
    expect(roots).toEqual([worktree, common, extra]);
  });
});

it("detects the bwrap denial dialect", () => {
  expect(isSandboxDenial("touch: cannot touch '/home/u/x': Read-only file system")).toBe(true);
  expect(isSandboxDenial("Error: EROFS: read-only file system, open '/home/u/x'")).toBe(true);
  expect(isSandboxDenial("permission denied")).toBe(false);
});

interface Spawned {
  command: string;
  args: string[];
}

/** PTY fake: a bwrap spawn prints the denial and exits 1, an unconfined one succeeds. */
function recordingPty(spawned: Spawned[]) {
  return (command: string, args: string[]): PtyHandle => {
    spawned.push({ command, args });
    let dataCb: ((chunk: string) => void) | undefined;
    let exitCb: ((event: { exitCode: number }) => void) | undefined;
    setTimeout(() => {
      if (command === "bwrap") {
        dataCb?.("Error: EROFS: read-only file system, open '/home/u/x'\r\n");
        exitCb?.({ exitCode: 1 });
      } else {
        dataCb?.("ok\r\n");
        exitCb?.({ exitCode: 0 });
      }
    }, 0);
    return {
      pid: 999_999,
      write() {},
      kill() {},
      onData(cb) {
        dataCb = cb;
        return { dispose: () => undefined };
      },
      onExit(cb) {
        exitCb = cb;
        return { dispose: () => undefined };
      },
    };
  };
}

describe("runSandboxedShell (run_unconfined card)", () => {
  beforeEach(() => {
    // The fork ignores this env value: the sandbox is always off (plan 068 D14).
    process.env.SANDBOX_MODE = "workspace-write";
  });

  it("runs unconfined once and never asks for a card now that the sandbox is off", async () => {
    resetSandboxProbeForTest(() => true);
    const spawned: Spawned[] = [];
    const events: string[] = [];
    const requestUnconfined = vi.fn(async () => ({ allowed: true, via: "allow" }));
    const result = await runSandboxedShell(
      root,
      "npm",
      ["run", "test"],
      { spawnImpl: recordingPty(spawned), onEvent: (type) => void events.push(type), requestUnconfined },
      false
    );
    expect(requestUnconfined).not.toHaveBeenCalled();
    expect(spawned.map((s) => s.command)).toEqual(["npm"]);
    expect(result).toMatchObject({ code: 0 });
    expect(result.stdout).toContain("ok");
    expect(result.unconfined).toBeUndefined();
    expect(result.sandbox).toBeUndefined();
    expect(events).toEqual(["shell.command"]);
  });

  it("never reaches the card-declined path when the sandbox is off", async () => {
    resetSandboxProbeForTest(() => true);
    const spawned: Spawned[] = [];
    const requestUnconfined = vi.fn(async () => ({ allowed: false, via: "deny", reason: "Denied by the user" }));
    const result = await runSandboxedShell(root, "npm", ["run", "test"], { spawnImpl: recordingPty(spawned), requestUnconfined }, false);
    expect(spawned.map((s) => s.command)).toEqual(["npm"]);
    expect(result.code).toBe(0);
    expect(result.sandbox).toBeUndefined();
    expect(result.unconfined).toBeUndefined();
    expect(result.stderr).not.toContain("not run unconfined");
    expect(requestUnconfined).not.toHaveBeenCalled();
  });

  it("runs unconfined even when bwrap is unavailable, with no card and no SANDBOX_UNAVAILABLE", async () => {
    resetSandboxProbeForTest(() => false);
    const spawned: Spawned[] = [];
    const requestUnconfined = vi.fn(async () => ({ allowed: false, via: "deny", reason: "Denied by the user" }));
    const result = await runSandboxedShell(root, "npm", ["run", "test"], { spawnImpl: recordingPty(spawned), requestUnconfined }, false);
    expect(spawned.map((s) => s.command)).toEqual(["npm"]);
    expect(requestUnconfined).not.toHaveBeenCalled();
    expect(result.sandbox).toBeUndefined();
    expect(result.stderr).not.toContain(SANDBOX_UNAVAILABLE);
  });

  it("does not ask when the mode is off", async () => {
    process.env.SANDBOX_MODE = "off";
    const spawned: Spawned[] = [];
    const requestUnconfined = vi.fn();
    const result = await runSandboxedShell(root, "npm", ["run", "test"], { spawnImpl: recordingPty(spawned), requestUnconfined }, false);
    expect(spawned.map((s) => s.command)).toEqual(["npm"]);
    expect(requestUnconfined).not.toHaveBeenCalled();
    expect(result.sandbox).toBeUndefined();
  });
});
