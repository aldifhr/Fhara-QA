/**
 * Plan 040 (P2): routing correctness — now on the QA-only roster (plan 068).
 * - An unknown role is not a retired role; unmatched work never lands on the
 *   highest-priority fallback: it is BLOCKED with a reason.
 * - The planner does not silently drop nodes: work nodes stay (BLOCKED at
 *   run time), helper nodes are dropped with a visible adjustment, and a
 *   code_change on an agent that may not write becomes an analysis.
 * - One owner rule for fixes: the agent that wrote the code.
 * - No role has a `general` catch-all; the single QA role owns browser testing.
 */
import { describe, expect, it } from "vitest";
import { routeCapability, unroutedReason } from "@/orchestrator/capabilities";
import { ownerForFix } from "@/orchestrator/ownership";
import { evaluateDelegation } from "@/orchestrator/delegation";
import { BudgetTracker } from "@/orchestrator/budget";
import { loadPolicy } from "@/orchestrator/policy";
import { classifyCommand } from "@/orchestrator/classifier";
import { createPlan, heuristicPlan } from "@/orchestrator/planner";
import { ROLES } from "@/api/convex/lib/roles";
import type { TaskLlmResolver } from "@/llm/resolver";
import type { AgentDefinition, PlanSubtask } from "@/types";

const policy = loadPolicy();

/** The one fixed role in this fork. */
function qaAgent(id = "qa"): AgentDefinition {
  return {
    _id: id,
    name: ROLES.qa.label,
    role: "qa",
    capabilities: [...ROLES.qa.capabilities],
    supportedTools: [...ROLES.qa.defaultTools],
    priority: ROLES.qa.priority,
    isEnabled: true,
  };
}

const QA = qaAgent();
/** Custom agents keep the declared-tools harness the earlier roster used. */
const WRITER: AgentDefinition = {
  _id: "writer",
  name: "Writer",
  role: "custom-writer",
  capabilities: ["frontend-development", "backend-development"],
  supportedTools: ["read_file", "write_file"],
  priority: 5,
  isEnabled: true,
};
const NO_WRITE: AgentDefinition = {
  _id: "nowrite",
  name: "NoWrite",
  role: "custom-nowrite",
  capabilities: ["research", "security-audit"],
  supportedTools: ["read_file"],
  priority: 1,
  isEnabled: true,
};
const DOCS: AgentDefinition = {
  _id: "docs",
  name: "Docs",
  role: "custom-docs",
  capabilities: ["documentation-support"],
  supportedTools: ["read_file"],
  priority: 1,
  isEnabled: true,
};
const team = [QA, WRITER, NO_WRITE, DOCS];

function resolverAnswering(content: string): TaskLlmResolver {
  return {
    handlesFor: () => [
      {
        connectionId: "",
        connectionName: "fake",
        config: { provider: "openai-compatible", model: "m", apiKey: "x", baseUrl: "http://x" } as never,
        provider: { complete: async () => ({ content }) },
      },
    ],
  } as unknown as TaskLlmResolver;
}

describe("capability routing: no fallback owner", () => {
  it("default policy has the fallback off", () => {
    expect(policy.allowFallback).toBe(false);
  });

  it("an unmatched capability routes to nobody (not a retired role)", () => {
    expect(routeCapability("quantum-gardening", team)).toBeNull();
    expect(unroutedReason("quantum-gardening", team)).toMatch(/No agent available for capability "quantum-gardening": no enabled agent declares it/);
  });

  it("even the opt-in fallback cannot conjure an owner from nobody", () => {
    expect(routeCapability("quantum-gardening", [QA], { allowFallback: true })?._id).toBe("qa");
    expect(routeCapability("quantum-gardening", [], { allowFallback: true })).toBeNull();
    expect(routeCapability("quantum-gardening", [NO_WRITE], { allowFallback: true })?._id).toBe("nowrite");
  });

  it("a code-writing capability goes only to an agent that may write", () => {
    const readOnlyClaimingFrontend = { ...NO_WRITE, _id: "d2", capabilities: ["frontend-development"] };
    expect(routeCapability("frontend-development", [readOnlyClaimingFrontend, NO_WRITE])).toBeNull();
    expect(unroutedReason("frontend-development", [readOnlyClaimingFrontend])).toMatch(/may not write files/);
    expect(routeCapability("frontend-development", team)?._id).toBe("writer");
  });

  it("D2/D3: no general catch-all; retired security/work capabilities stay with the agents that declare them", () => {
    for (const role of Object.values(ROLES)) expect(role.capabilities).not.toContain("general");
    expect(routeCapability("general", team)).toBeNull();
    expect(routeCapability("security-audit", [NO_WRITE])?._id).toBe("nowrite");
    expect(routeCapability("security-audit", team)?._id).toBe("nowrite");
    expect(classifyCommand("hi").suggestedCapabilities).toEqual(["documentation-support"]);
  });

  it("a custom role with a frontend capability routes by capability", () => {
    expect(routeCapability("frontend-development", [WRITER, QA])?._id).toBe("writer");
    const noTools: AgentDefinition = { ...WRITER, _id: "cy", supportedTools: ["read_file"] };
    expect(routeCapability("frontend-development", [noTools])).toBeNull();
  });
});

describe("planner: nodes are never dropped silently", () => {
  it("conversation reply goes to the topic owner, not a retired orchestrator role", () => {
    const plan = heuristicPlan({ command: "hello", classification: classifyCommand("hello"), agents: team, policy });
    expect(plan.subtasks[0].capability).toBe("documentation-support");
    expect(routeCapability(plan.subtasks[0].capability, team)?._id).toBe("docs");
  });

  it("unroutable work stays (blocked), unroutable helpers drop visibly, and a read-only owner makes code_change an analysis", async () => {
    const llmPlan = JSON.stringify({
      goal: "Build pricing page",
      strategy: "dag",
      requiresApproval: true,
      maxConcurrency: 1,
      subtasks: [
        { key: "design", title: "Design pricing", description: "pricing layout spec", kind: "code_change", capability: "research", dependencies: [], order: 0 },
        { key: "impl", title: "Implement pricing", description: "edit app/pricing/page.tsx", kind: "code_change", capability: "frontend-development", dependencies: ["design"], order: 1 },
        { key: "ml", title: "Train model", description: "edit ml/train.py", kind: "code_change", capability: "ml-engineering", dependencies: [], order: 2 },
        { key: "astro", title: "Horoscope", description: "read the stars", kind: "analysis", capability: "astrology", dependencies: [], order: 3 },
      ],
    });
    const command = "Build the pricing page";
    const result = await createPlan({
      command,
      classification: classifyCommand(command),
      agents: team,
      policy: { ...policy, reviewMode: "never", qaMode: "never" },
      llmResolver: resolverAnswering(llmPlan),
    });
    const keys = result.plan.subtasks.map((s) => s.key);
    expect(keys).toContain("ml");
    expect(keys).not.toContain("astro");
    expect(result.plan.subtasks.find((s) => s.key === "design")?.kind).toBe("analysis");
    const actions = Object.fromEntries((result.routingAdjustments ?? []).map((a) => [a.key, a.action]));
    expect(actions).toMatchObject({ design: "made_read_only", ml: "blocked", astro: "dropped" });
    expect((result.routingAdjustments ?? []).every((a) => a.reason.length > 0)).toBe(true);
    expect(result.droppedHintKeys).toEqual(["astro"]);
  });
});

describe("one fix-owner rule: the agent that wrote the code", () => {
  const subtasks: PlanSubtask[] = [
    { key: "fe", title: "fe", description: "", kind: "code_change", capability: "frontend-development", dependencies: [], order: 0, allowedPaths: ["apps/web"] },
    { key: "be", title: "be", description: "", kind: "code_change", capability: "backend-development", dependencies: [], order: 1, allowedPaths: ["apps/api/convex"] },
    { key: "docs", title: "docs", description: "", kind: "analysis", capability: "documentation-support", dependencies: [], order: 2 },
  ];
  const writer = { ...WRITER, _id: "be-2", name: "Writer 2" };
  const writerByKey = new Map([["be", writer]]);

  it("a finding in a backend file goes to the agent that ran the backend node", () => {
    const owner = ownerForFix({ subtasks, findings: [{ filePath: "apps/api/convex/tasks.ts" }], agents: [...team, writer], writerByKey });
    expect(owner?.subtask.key).toBe("be");
    expect(owner?.agent._id).toBe("be-2");
  });

  it("without a recorded writer, the owner subtask's capability decides", () => {
    const owner = ownerForFix({ subtasks, findings: [{ filePath: "apps/web/app/page.tsx" }], agents: team });
    expect(owner?.agent._id).toBe("writer");
  });

  it("no implementation subtask → nobody (never Support / general)", () => {
    expect(ownerForFix({ subtasks: [subtasks[2]], findings: [{ filePath: "README.md" }], agents: team })).toBeNull();
  });

  it("critical findings go to the actual implementer, not the first writer in the roster", () => {
    const evaluation = evaluateDelegation({
      result: {
        agentId: "qa",
        agentName: "QA",
        capability: "security-audit",
        success: true,
        summary: "found an authz hole",
        findings: [{ severity: "critical", filePath: "apps/api/convex/tasks.ts", description: "missing authz", suggestion: "" }],
      } as never,
      classification: classifyCommand("audit security"),
      agents: [...team, writer],
      budget: new BudgetTracker(policy),
      previousAgents: [],
      delegationDepth: 0,
      alreadyDelegatedCapabilities: [],
      planSubtasks: subtasks,
      writerByKey,
    });
    expect(evaluation.decision).toBe("REVISE");
    expect(evaluation.targetAgent?._id).toBe("be-2");
    expect(evaluation.targetCapability).toBe("backend-development");
  });
});
