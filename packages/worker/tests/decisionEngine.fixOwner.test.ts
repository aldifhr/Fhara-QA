/**
 * P1b phase 3 (L7): `decideFixOwner`, the one answer to a stage loop's
 * `fix_needed`. Every branch: exhausted, unowned, QA's UI preference, the
 * writer pin, per-stage fix nodes (key, title, scope, order). The loops'
 * event sequences are pinned by tests/decisionEngine.golden.test.ts
 * (fix-* scenarios). The roster is QA-only (plan 068); production-code
 * writers are custom agents that declare write_file, as in the earlier
 * multi-role fork.
 */
import { describe, expect, it } from "vitest";
import {
  attributeFinding,
  decideFixOwner,
  fixRoundsExhausted,
  pickQaFixOwner,
  verifyFixKey,
  type FixNeededFacts,
} from "@/orchestrator/decisionEngine";
import { ROLES } from "@/api/convex/lib/roles";
import type { AgentDefinition, PlanSubtask } from "@/types";
import type { ReviewFinding } from "@/utils/json";

const QA: AgentDefinition = {
  _id: "qa",
  name: ROLES.qa.label,
  role: "qa",
  capabilities: [...ROLES.qa.capabilities],
  supportedTools: [...ROLES.qa.defaultTools],
  priority: ROLES.qa.priority,
  isEnabled: true,
};
const UI: AgentDefinition = {
  _id: "ui",
  name: "UI Writer",
  role: "custom-ui",
  capabilities: ["frontend-development"],
  supportedTools: ["read_file", "write_file"],
  priority: 5,
  isEnabled: true,
};
const API: AgentDefinition = {
  _id: "api",
  name: "API Writer",
  role: "custom-api",
  capabilities: ["backend-development"],
  supportedTools: ["read_file", "write_file"],
  priority: 4,
  isEnabled: true,
};
const READ_ONLY_UI: AgentDefinition = {
  _id: "readonly-ui",
  name: "ReadOnly UI",
  role: "custom-readonly-ui",
  capabilities: ["frontend-development"],
  supportedTools: ["read_file"],
  priority: 1,
  isEnabled: true,
};

const team = [QA, UI, API];
const byRole = (role: string) => team.find((agent) => agent.role === role || agent._id === role)!;

const sub = (key: string, capability: string, order: number, extra: Partial<PlanSubtask> = {}): PlanSubtask => ({
  key,
  title: key,
  description: "",
  kind: "code_change",
  capability,
  dependencies: [],
  order,
  ...extra,
});

const UI_NODE = sub("ui", "frontend-development", 0, { allowedPaths: ["web/"] });
const API_NODE = sub("api", "backend-development", 3, { allowedPaths: ["api/"] });
const REVIEW = sub("review", "code-review", 4, { kind: "review" });
const finding = (filePath: string): ReviewFinding => ({ severity: "high", filePath, description: `bad ${filePath}`, suggestion: "fix it" });

const facts = (over: Partial<FixNeededFacts> = {}): FixNeededFacts => ({
  stage: "review",
  round: 0,
  maxRounds: 1,
  findings: [finding("api/server.ts")],
  nodes: [UI_NODE, API_NODE, REVIEW],
  writerByKey: new Map(),
  agents: team,
  ...over,
});

const keys = (taken: string[]) => (base: string) => {
  let key = base;
  for (let suffix = 2; taken.includes(key); suffix += 1) key = `${base}_${suffix}`;
  return key;
};
const decide = (over: Partial<FixNeededFacts> = {}, taken: string[] = []) =>
  decideFixOwner({ kind: "fix_needed", facts: facts(over) }, keys(taken));

describe("decideFixOwner: when the loop stops", () => {
  it("blocks as exhausted once the rounds are spent, before looking for an owner", () => {
    let calls = 0;
    const out = decideFixOwner({ kind: "fix_needed", facts: facts({ round: 1, maxRounds: 1, nodes: [] }) }, (base) => {
      calls += 1;
      return base;
    });
    expect(out).toEqual({ kind: "block", reason: "exhausted" });
    expect(calls).toBe(0);
    expect(decide({ round: 3, maxRounds: 1 })).toEqual({ kind: "block", reason: "exhausted" });
  });

  it("a zero-round budget is exhausted at round 0", () => {
    expect(decide({ round: 0, maxRounds: 0 })).toEqual({ kind: "block", reason: "exhausted" });
    expect(fixRoundsExhausted(0, 1)).toBe(false);
    expect(fixRoundsExhausted(1, 1)).toBe(true);
  });

  it("blocks as unowned when no code_change exists", () => {
    expect(decide({ nodes: [REVIEW] })).toEqual({ kind: "block", reason: "unowned" });
  });

  it("blocks as unowned when the only owner may not write", () => {
    expect(decide({ nodes: [UI_NODE], agents: [READ_ONLY_UI] })).toEqual({ kind: "block", reason: "unowned" });
  });
});

describe("decideFixOwner: who fixes", () => {
  it("review: the longest-prefix owner, routed by capability when no writer is recorded", () => {
    const out = decide();
    expect(out.kind).toBe("spawn_fix");
    if (out.kind !== "spawn_fix") return;
    expect(out.ownerNodeKey).toBe("api");
    expect(out.agent._id).toBe("api");
    expect(out.ownerAgentId).toBe(out.agent._id);
  });

  it("the agent that wrote the owner node wins over capability routing", () => {
    const writer = { ...byRole("api"), _id: "api-2", name: "API Writer 2" };
    const out = decide({ agents: [...team, writer], writerByKey: new Map([["api", writer]]) });
    expect(out.kind === "spawn_fix" && out.ownerAgentId).toBe("api-2");
  });

  it("a writer no longer on the roster falls back to capability routing", () => {
    const gone = { ...byRole("api"), _id: "gone" };
    const out = decide({ writerByKey: new Map([["api", gone]]) });
    expect(out.kind === "spawn_fix" && out.ownerAgentId).toBe("api");
  });

  it("no finding path: the last code_change owns it", () => {
    const out = decide({ findings: [finding("")] });
    expect(out.kind === "spawn_fix" && out.ownerNodeKey).toBe("api");
  });

  it("qa: a UI implementer owns the fix even when the path points elsewhere", () => {
    const out = decide({ stage: "qa", findings: [finding("api/server.ts")] });
    expect(out.kind === "spawn_fix" && out.ownerNodeKey).toBe("ui");
    expect(out.kind === "spawn_fix" && out.agent._id).toBe("ui");
  });

  it("qa without a UI node falls back to the shared rule", () => {
    const out = decide({ stage: "qa", nodes: [API_NODE, REVIEW] });
    expect(out.kind === "spawn_fix" && out.ownerNodeKey).toBe("api");
  });

  it("verify: no UI preference, the path owner wins", () => {
    const out = decide({ stage: "verify", findings: [finding("api/server.ts")] });
    expect(out.kind === "spawn_fix" && out.ownerNodeKey).toBe("api");
  });
});

describe("decideFixOwner: the fix node", () => {
  it("review: review_fix_<n>, no path scope, ordered after every node", () => {
    const out = decide({ round: 0, maxRounds: 2 });
    if (out.kind !== "spawn_fix") throw new Error("expected spawn_fix");
    expect(out.nodes).toHaveLength(1);
    const [fix] = out.nodes;
    expect(fix).toMatchObject({ key: "review_fix_1", title: "Address review findings (iteration 1)", kind: "code_change", capability: "backend-development", order: 5, dependencies: [] });
    expect(fix.allowedPaths).toBeUndefined();
    expect(fix.description).toContain("bad api/server.ts");
  });

  it("qa: fix_qa_<n>, unique key, scoped to the owner's paths (a copy)", () => {
    const out = decide({ stage: "qa", round: 1, maxRounds: 2 }, ["fix_qa_2"]);
    if (out.kind !== "spawn_fix") throw new Error("expected spawn_fix");
    const [fix] = out.nodes;
    expect(fix).toMatchObject({ key: "fix_qa_2_2", title: "Address QA failures (iteration 2)", capability: "frontend-development", allowedPaths: ["web/"] });
    expect(fix.allowedPaths).not.toBe(UI_NODE.allowedPaths);
  });

  it("qa: an owner without paths gives an unscoped fix", () => {
    const out = decide({ stage: "qa", nodes: [sub("ui2", "frontend-development", 0)] });
    expect(out.kind === "spawn_fix" && out.nodes[0].allowedPaths).toBeUndefined();
  });

  it("verify phase 0: the legacy fix_verify_<n> key and title", () => {
    const out = decide({ stage: "verify" });
    if (out.kind !== "spawn_fix") throw new Error("expected spawn_fix");
    expect(out.nodes[0]).toMatchObject({ key: "fix_verify_1", title: "Address verification failures (iteration 1)", allowedPaths: ["api/"] });
  });

  it("verify after a QA fix round: the phase rides in key and title", () => {
    const out = decide({ stage: "verify", verifyPhase: 2, round: 0, maxRounds: 1 });
    if (out.kind !== "spawn_fix") throw new Error("expected spawn_fix");
    expect(out.nodes[0]).toMatchObject({ key: "fix_verify_qa2_1", title: "Address verification failures (after QA fix 2, iteration 1)" });
  });
});

describe("moved helpers keep their behaviour", () => {
  it("verifyFixKey", () => {
    expect(verifyFixKey(0, 3)).toBe("fix_verify_3");
    expect(verifyFixKey(1, 2)).toBe("fix_verify_qa1_2");
  });

  it("attributeFinding", () => {
    expect(attributeFinding({ files: ["x.ts", "a.ts"] }, ["a.ts"])).toBe("a.ts");
    expect(attributeFinding({}, [])).toBe("");
  });

  it("pickQaFixOwner prefers UI nodes, else the shared rule", () => {
    expect(pickQaFixOwner([UI_NODE, API_NODE], [{ filePath: "api/x.ts" }])?.key).toBe("ui");
    expect(pickQaFixOwner([API_NODE], [{ filePath: "api/x.ts" }])?.key).toBe("api");
    expect(pickQaFixOwner([REVIEW], [])).toBeUndefined();
  });
});
