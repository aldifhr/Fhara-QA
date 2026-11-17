import * as path from "node:path";

/**
 * QA fork (plan 068, D14): the path sandbox is removed by owner decision.
 *
 * Resolution still maps a workspace-relative path to an absolute one so file
 * tools keep working, but absolute paths and `..` segments are no longer
 * refused. Forbidden-file rules (`.env`, credentials, another task's files)
 * live in the edit/read guards and the exact-argv allowlist stays intact.
 */
export class SandboxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SandboxError";
  }
}

export function resolveSandboxPath(workspaceRoot: string, requested: string): string {
  const root = path.resolve(workspaceRoot);
  return path.isAbsolute(requested) ? path.resolve(requested) : path.resolve(root, requested);
}

/** Pure helper retained for callers that only want to classify a path. */
export function isWithinWorkspace(workspaceRoot: string, filepath: string): boolean {
  const root = path.resolve(workspaceRoot);
  const file = path.resolve(filepath);
  const rel = path.relative(root, file);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return false;
  return true;
}

export async function resolveSandboxPathAsync(
  workspaceRoot: string,
  requested: string
): Promise<string> {
  return resolveSandboxPath(workspaceRoot, requested);
}

/** MCP paths are forwarded as resolved absolute paths; no containment check. */
export async function resolveWithinRootsAsync(
  roots: string[],
  requested: string
): Promise<{ ok: true; path: string } | { ok: false; reason: "not-absolute" | "outside-roots" }> {
  return { ok: true, path: resolveSandboxPath(roots[0] ?? "", requested) };
}
