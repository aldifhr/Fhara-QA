/**
 * Plan 040 (P1): role permissions are enforced by the executor, not only by
 * the prompt. In this QA-only fork the single role writes only test paths;
 * production paths stay refused, QA runs verification commands only (plus
 * the exact Playwright argv), and destructive commands never run without an
 * approval channel. Retired role names resolve to QA.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { executeSubtask, roleRefusal, type SubtaskExecutionInput } from "@/execution/agentExecutor";
import {
  canWritePath,
  isVerifyCommand,
  permissionsForAgent,
  shellDenial,
  writeDenial,
} from "@/utils/rolePolicy";
import { tool_call } from "@/governance/registry";
import { isCommandAllowed } from "@/utils/commandAllowlist";
import { ROLES, ROLE_KEYS, permissionsFromTools } from "@/api/convex/lib/roles";
import type { FallbackHandle } from "@/effects/llmCall";
import type { GlobalLLMConfig, LLMProvider } from "@/llm";
import type { AgentDefinition, PlanSubtask } from "@/types";
import type { FileDiff } from "@/tools/gitDiff";

const CONFIG: GlobalLLMConfig = { provider: "openai-compatible", model: "m", baseUrl: "http://127.0.0.1:9", apiKey: "k" };

let workspace: string;
beforeEach(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), "fhara-roleperm-"));
  await fs.writeFile(path.join(workspace, "index.html"), "<h1>Hi</h1>\n");
});
afterEach(async () => {
  await fs.rm(workspace, { recursive: true, force: true });
});

function agent(role: string, extra: Partial<AgentDefinition> = {}): AgentDefinition {
  return { _id: `agent-${role}`, name: role, role, capabilities: [], isEnabled: true, priority: 1, ...extra };
}

function subtask(kind: PlanSubtask["kind"], extra: Partial<PlanSubtask> = {}): PlanSubtask {
  return { key: "n1", title: "node", description: "Edit index.html", kind, capability: "frontend-development", dependencies: [], order: 0, ...extra };
}

function counting(reply: string): { provider: LLMProvider; calls: () => number } {
  let n = 0;
  return {
    provider: { complete: async () => { n += 1; return { content: reply, inputTokens: 1, outputTokens: 1 }; } },
    calls: () => n,
  };
}

function input(a: AgentDefinition, s: PlanSubtask, provider: LLMProvider, saved: FileDiff[] = [], events: Array<{ type: string; payload: unknown }> = [], extra: Partial<SubtaskExecutionInput> = {}): SubtaskExecutionInput {
  const handle: FallbackHandle = { connectionId: "c", connectionName: "t", config: CONFIG, provider };
  return {
    workspacePath: workspace,
    command: "change the page",
    plan: { version: 1, goal: "g", strategy: "single", requiresApproval: false, maxConcurrency: 1, subtasks: [s] },
    subtask: s,
    agent: a,
    llmHandles: [handle],
    priorOutputs: new Map(),
    fileChanges: [],
    signal: new AbortController().signal,
    deadlineAt: Date.now() + 60_000,
    onEvent: async (type: string, payload: unknown) => { events.push({ type, payload }); },
    onMessage: async () => undefined,
    onChunk: async () => undefined,
    saveFileChange: async (change: FileDiff) => { saved.push(change); },
    ...extra,
  } as SubtaskExecutionInput;
}

const WRITE_REPLY = JSON.stringify({ files: [{ filePath: "index.html", newContent: "<h1>Hello</h1>\n" }] });
const SPEC_REPLY = JSON.stringify({ files: [{ filePath: "tests/example.spec.ts", newContent: "test('ok', () => {});\n" }] });
const PLAYWRIGHT_REPLY = JSON.stringify({ files: [{ filePath: "playwright.config.ts", newContent: "export default {};\n" }] });

describe("role permission table", () => {
  it("every role has permissions and none may push", () => {
    for (const key of ROLE_KEYS) {
      expect(ROLES[key].permissions.read).toBe(true);
      expect(ROLES[key].permissions.push).toBe(false);
    }
  });

  it("qa writes test paths only; production paths stay refused", () => {
    const qa = ROLES.qa.permissions;
    expect(qa.write).toEqual(["tests/**", "e2e/**", "**/*.test.*", "**/*.spec.*", "**/__tests__/**", "playwright.config.*"]);
    for (const ok of ["tests/example.spec.ts", "e2e/flow.spec.ts", "src/app.test.ts", "src/app.spec.ts", "src/__tests__/app.ts", "playwright.config.ts"]) {
      expect(canWritePath(qa, ok), ok).toBe(true);
    }
    expect(ROLES.qa.defaultTools).toContain("write_file");
  });

  it("no live role gets web access; QA shell is verify-only", () => {
    expect(ROLE_KEYS.filter((key) => ROLES[key].permissions.web)).toEqual([]);
    expect(ROLES.qa.permissions.shell).toBe("verify");
  });

  it("qa refuses production, CI and infra paths; the glob gate also rejects escapes", () => {
    const qa = ROLES.qa.permissions;
    for (const no of ["index.html", "src/app.ts", "apps/api/convex/schema.ts", ".github/workflows/ci.yml", "Dockerfile", "docker-compose.yml", "infra/terraform/main.tf", "README.md"]) {
      expect(canWritePath(qa, no), no).toBe(false);
    }
    expect(canWritePath(qa, "../outside.spec.ts")).toBe(false);
  });

  it("resolves retired titles and aliases to qa; a custom role keeps what its tools allowed", () => {
    for (const role of ["UI/UX Designer", "Frontend Developer", "Backend Developer", "QA", "technical-writer", "Reviewer"]) {
      const perms = permissionsForAgent(agent(role));
      expect(canWritePath(perms, "tests/a.spec.ts"), role).toBe(true);
      expect(canWritePath(perms, "src/a.ts"), role).toBe(false);
      expect(perms.shell, role).toBe("verify");
    }
    expect(permissionsForAgent(agent("data-wrangler", { supportedTools: ["read_file", "write_file"] })).write).toBe(true);
    expect(permissionsForAgent(agent("data-wrangler", { supportedTools: ["read_file"] })).write).toBe(false);
    expect(permissionsFromTools(["run_command"]).push).toBe(false);
  });

  it("verify commands: tests/typecheck/build/read-only git and the exact Playwright argv", () => {
    expect(isVerifyCommand("npm", ["run", "test"])).toBe(true);
    expect(isVerifyCommand("npx", ["tsc", "--noEmit"])).toBe(true);
    expect(isVerifyCommand("git", ["diff", "--stat"])).toBe(true);
    expect(isVerifyCommand("npx", ["playwright", "test", "--reporter=json"])).toBe(true);
    expect(isVerifyCommand("npx", ["playwright", "test"])).toBe(false);
    expect(isVerifyCommand("npx", ["playwright", "test", "--reporter=json", "--workers=2"])).toBe(false);
    expect(isVerifyCommand("git", ["pull", "--rebase"])).toBe(false);
    expect(isVerifyCommand("git", ["fetch"])).toBe(false);
    expect(shellDenial("qa", ROLES.qa.permissions, "git", ["pull"])).toMatch(/only run tests/);
    expect(shellDenial("custom-nowrite", permissionsFromTools([]), "npm", ["run", "test"])).toMatch(/may not run commands/);
    expect(shellDenial("qa", ROLES.qa.permissions, "npx", ["playwright", "test", "--reporter=json"])).toBeNull();
    expect(writeDenial("qa", ROLES.qa.permissions, "src/a.ts")).toMatch(/may only write/);
    expect(writeDenial("qa", ROLES.qa.permissions, "tests/a.spec.ts")).toBeNull();
  });
});

describe("executor: qa writes only test paths", () => {
  it("qa: a production code_change is refused at the write gate, before staging", async () => {
    const { provider } = counting(WRITE_REPLY);
    const saved: FileDiff[] = [];
    const events: Array<{ type: string; payload: unknown }> = [];
    const result = await executeSubtask(input(agent("qa"), subtask("code_change"), provider, saved, events));
    expect(result.status).toBe("failed");
    expect(result.status === "failed" ? result.error : "").toMatch(/may only write/);
    expect(saved).toHaveLength(0);
    expect(events.map((e) => e.type)).toContain("agent.permission_denied");
  });

  it("the native (OpenCode) runtime is refused for a role that cannot write or run commands", () => {
    expect(roleRefusal({ agent: agent("custom-nowrite"), subtask: subtask("code_change") })).toMatch(/read-only/);
    expect(roleRefusal({ agent: agent("custom-nowrite"), subtask: subtask("shell") })).toMatch(/may not run commands/);
    expect(roleRefusal({ agent: agent("qa"), subtask: subtask("shell") })).toBeNull();
    expect(roleRefusal({ agent: agent("custom-nowrite"), subtask: subtask("analysis") })).toBeNull();
    expect(roleRefusal({ agent: agent("qa"), subtask: subtask("code_change") })).toBeNull();
  });

  it("qa stages a spec inside its test-path scope", async () => {
    const { provider } = counting(SPEC_REPLY);
    const saved: FileDiff[] = [];
    const result = await executeSubtask(input(agent("qa"), subtask("code_change", {
      capability: "browser-testing",
      allowedPaths: ["tests"],
    }), provider, saved));
    expect(result.status).toBe("completed");
    expect(saved.map((c) => c.filePath)).toEqual(["tests/example.spec.ts"]);
  });

  it("qa writes a playwright config too", async () => {
    const { provider } = counting(PLAYWRIGHT_REPLY);
    const saved: FileDiff[] = [];
    const result = await executeSubtask(input(agent("qa"), subtask("code_change", {
      capability: "browser-testing",
    }), provider, saved));
    expect(result.status).toBe("completed");
    expect(saved.map((c) => c.filePath)).toEqual(["playwright.config.ts"]);
  });

  it("a custom writer still writes production code inside scope", async () => {
    const { provider } = counting(WRITE_REPLY);
    const saved: FileDiff[] = [];
    const result = await executeSubtask(input(agent("custom-writer", { supportedTools: ["read_file", "write_file"] }), subtask("code_change"), provider, saved));
    expect(result.status).toBe("completed");
    expect(saved.map((c) => c.filePath)).toEqual(["index.html"]);
  });
});

describe("executor: path-limited writes", () => {
  it("refuses a write outside the subtask's allowed paths", async () => {
    const { provider } = counting(WRITE_REPLY);
    const saved: FileDiff[] = [];
    const result = await executeSubtask(input(agent("custom-writer", { supportedTools: ["read_file", "write_file"] }), subtask("code_change", {
      allowedPaths: [".github"],
    }), provider, saved));
    expect(result.status).toBe("failed");
    expect(result.status === "failed" ? result.error : "").toMatch(/ownership|allowed path/i);
    expect(saved).toHaveLength(0);
  });

  it("stages a file inside the allowed paths", async () => {
    const { provider } = counting(JSON.stringify({ files: [{ filePath: ".github/workflows/ci.yml", newContent: "name: ci\n" }] }));
    const saved: FileDiff[] = [];
    const result = await executeSubtask(input(agent("custom-writer", { supportedTools: ["read_file", "write_file"] }), subtask("code_change", {
      description: "Add CI workflow",
      allowedPaths: [".github"],
    }), provider, saved));
    expect(result.status).toBe("completed");
    expect(saved.map((c) => c.filePath)).toEqual([".github/workflows/ci.yml"]);
  });
});

describe("executor: shell permissions", () => {
  it("QA may run tests but not git pull", async () => {
    const { provider } = counting('{"command":"git","args":["pull"]}');
    const result = await executeSubtask(input(agent("qa"), subtask("shell", { capability: "browser-testing", description: "Run exactly: git pull" }), provider));
    expect(result.status).toBe("failed");
    expect(result.status === "failed" ? result.error : "").toMatch(/only run tests/);
  });

  it("QA node --version (verify) runs", async () => {
    const { provider } = counting('{"command":"node","args":["--version"]}');
    const result = await executeSubtask(input(agent("qa"), subtask("shell", { capability: "browser-testing", description: "Run exactly: node --version" }), provider));
    expect(result.status).toBe("completed");
  });

  it("QA accepts the exact Playwright argv (predicate only, never executes it here)", () => {
    // Executing the runner would launch Playwright; the allowlist/verify gates
    // are the invariant under test.
    expect(isCommandAllowed("npx", ["playwright", "test", "--reporter=json"])).toBe(true);
    expect(isCommandAllowed("npx", ["playwright", "test"])).toBe(false);
    expect(shellDenial("qa", ROLES.qa.permissions, "npx", ["playwright", "test", "--reporter=json"])).toBeNull();
  });

  it("a shell-less custom role is refused before any LLM call", async () => {
    const { provider, calls } = counting('{"command":"node","args":["--version"]}');
    const result = await executeSubtask(input(agent("custom-nowrite"), subtask("shell"), provider));
    expect(result.status).toBe("failed");
    expect(calls()).toBe(0);
  });
});

describe("governance broker follows the role policy", () => {
  const ctx = (role: string) => ({ workspacePath: "/tmp/none", agentRole: role, audit: async () => undefined }) as never;
  it("qa may not write_file outside a test path", async () => {
    for (const path of ["a.txt", "src/a.ts"]) {
      const result = await tool_call({ ctx: ctx("qa"), supportedTools: ["write_file"], name: "write_file", args: { path, content: "x" } });
      expect(result.ok, path).toBe(false);
      expect((result as { reason?: string }).reason ?? "").toMatch(/path-not-allowed-for-role/);
    }
  });
  it("an agent without run_command in its declared tools may not call it", async () => {
    const result = await tool_call({ ctx: ctx("qa"), supportedTools: ["read_file"], name: "run_command", args: { command: "git status" } });
    expect((result as { reason?: string }).reason ?? "").toBe("tool-unknown");
  });
});
