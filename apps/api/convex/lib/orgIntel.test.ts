import { describe, expect, test } from "vitest";
import { buildOrgChart, type OrgAgentInput } from "./orgChart";
import { buildCapacity, countActiveByAgent, type CapacityExecutionInput } from "./capacity";
import { buildCollaborationGraph, chatHandoffs } from "./collaboration";
import { aggregateAgentProfile } from "./agentProfile";
import { aggregateWorkload, routeLoadAware } from "./workload";
import { extractRouting } from "./routing";

const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

const orgAgent = (over: Partial<OrgAgentInput> & { id: string; role: string }): OrgAgentInput => ({
  name: over.role,
  enabled: true,
  retired: false,
  model: "Default model",
  runtime: "api",
  skills: 0,
  tools: [],
  capabilities: [],
  ...over,
});

describe("buildOrgChart", () => {
  test("QA Assistant at the top, retired roles folded into QA, custom roles get nodes", () => {
    const chart = buildOrgChart(
      [
        orgAgent({ id: "c", role: "cto", name: "Assistant", model: "gpt-x", skills: 2, tools: ["read_file"] }),
        orgAgent({ id: "f", role: "frontend", name: "Frontend", enabled: false }),
        orgAgent({ id: "b", role: "backend", name: "Backend" }),
        orgAgent({ id: "g", role: "growth", retired: true, enabled: false }), // retired → hidden
        orgAgent({ id: "x", role: "data-scientist", name: "Data" }),
      ],
      [{ key: "qa", name: "Assistant", enabled: true }]
    );
    expect(chart.rootKey).toBe("c");
    expect(chart.nodes[0]).toMatchObject({ key: "c", parent: null, label: "Assistant", roleKey: "qa", model: "gpt-x", skills: 2, tools: ["read_file"], registryName: "Assistant" });
    // All legacy roles resolve to qa; only custom roles keep their own node.
    const children = chart.nodes.filter((n) => n.parent === "c");
    expect(children.map((n) => n.roleKey)).toEqual(["qa", "qa", "data-scientist"]);
    expect(chart.nodes.find((n) => n.agentId === "f")).toMatchObject({ roleKey: "qa", enabled: false });
    expect(chart.nodes.find((n) => n.roleKey === "data-scientist")).toMatchObject({ fixed: false, agentId: "x" });
    expect(chart.nodes.some((n) => n.agentId === "g")).toBe(false);
    expect(chart.counts).toEqual({ agents: 4, enabled: 3, vacant: 0, custom: 1 });
  });

  test("no QA agent → a vacant QA root", () => {
    const chart = buildOrgChart([orgAgent({ id: "d", role: "data-scientist", name: "Data" })], []);
    expect(chart.rootKey).toBe("role:qa");
    expect(chart.nodes.find((n) => n.agentId === "d")?.parent).toBe("role:qa");
  });
});

describe("capacity", () => {
  const exec = (over: Partial<CapacityExecutionInput>): CapacityExecutionInput => ({
    agentId: "fe",
    status: "running",
    taskStatus: "running",
    taskId: "t1",
    projectId: "p1",
    leaseExpiresAt: NOW + 60_000,
    ...over,
  });
  const rows = [
    exec({}),
    exec({ status: "waiting_approval", taskId: "t2" }),
    exec({ taskStatus: "done" }), // terminal task → not load
    exec({ leaseExpiresAt: NOW - 1 }), // lapsed lease → stale
    exec({ status: "completed" }),
    exec({ agentId: "be" }),
    exec({ agentId: null }),
  ];

  test("counts running + waiting_approval on live tasks with a live lease", () => {
    expect(countActiveByAgent(rows, NOW)).toEqual({ fe: 2, be: 1 });
  });

  test("capacity rows: running vs limit (unset limit = 1), spare, stale", () => {
    const view = buildCapacity(
      [
        { id: "fe", name: "Frontend", role: "frontend", enabled: true, maxConcurrency: 2 },
        { id: "be", name: "Backend", role: "backend", enabled: true },
        { id: "qa", name: "QA", role: "qa", enabled: false, maxConcurrency: 3 },
      ],
      rows,
      NOW
    );
    expect(view.rows.map((r) => r.agentId)).toEqual(["fe", "be", "qa"]);
    expect(view.rows[0]).toMatchObject({ running: 2, limit: 2, spare: 0, utilization: 1, stale: 1 });
    expect(view.rows[1]).toMatchObject({ running: 1, limit: 1, spare: 0 });
    expect(view.totals).toEqual({ running: 3, limit: 3, atCapacity: 2, stale: 1 });
  });
});

describe("collaboration graph", () => {
  const agents = [
    { id: "c", name: "CTO", role: "cto" },
    { id: "f", name: "Frontend", role: "frontend" },
    { id: "b", name: "Backend", role: "backend" },
    { id: "q", name: "QA", role: "qa" },
    // A custom teammate, so a reply can still name more than three people.
    { id: "d", name: "Data", role: "data-scientist" },
  ];
  const at = NOW - DAY;

  test("chat handoffs: only recorded handoffs survive the QA-only roster (no CTO to infer @mentions from)", () => {
    const hs = chatHandoffs(
      [
        { id: "1", conversationId: "k", authorType: "user", agentId: null, content: "hi", at: 1 },
        { id: "2", conversationId: "k", authorType: "agent", agentId: "c", content: "@Frontend please check the form. @Backend the API.", at: 2 },
        { id: "3", conversationId: "k", authorType: "agent", agentId: "f", content: "ok", at: 3 },
        { id: "4", conversationId: "k", authorType: "agent", agentId: "b", content: "ok", at: 4, handoffFromAgentId: "c" },
        { id: "5", conversationId: "k", authorType: "user", agentId: null, content: "thanks", at: 5 },
        { id: "6", conversationId: "k", authorType: "agent", agentId: "f", content: "again", at: 6 },
      ],
      agents
    );
    expect(hs).toEqual([{ fromAgentId: "c", toAgentId: "b", at: 4, recorded: true }]);
  });

  test("a CTO reply naming more than three teammates is not a handoff", () => {
    const hs = chatHandoffs(
      [
        { id: "2", conversationId: "k", authorType: "agent", agentId: "c", content: "@Frontend @Backend @QA @Data team", at: 2 },
        { id: "3", conversationId: "k", authorType: "agent", agentId: "f", content: "ok", at: 3 },
      ],
      agents
    );
    expect(hs).toEqual([]);
  });

  test("edges: delegation, chat, review/QA → fix owner, cross-role dependencies; window and same-role filtered", () => {
    const st = (key: string, kind: string, role: string | null, deps: string[] = [], taskId = "t1", when = at) => ({
      taskId, key, kind, role, dependencies: deps, at: when, origin: null,
    });
    // Plan 068: legacy roles all collapse to qa, so a custom role supplies the
    // second bucket for cross-role edges; qa→qa edges are filtered.
    const graph = buildCollaborationGraph({
      now: NOW,
      sinceDays: 7,
      agents: [
        { id: "q", name: "Assistant", role: "qa" },
        { id: "d", name: "Data", role: "data-scientist" },
      ],
      rosterRoles: ["qa", "data-scientist"],
      subtasks: [
        st("api", "code_change", "qa"),
        st("ui", "code_change", "data-scientist", ["api"]),
        st("ui_polish", "code_change", "data-scientist", ["ui"]), // same role → no edge
        st("review", "review", "qa", ["ui"]),
        st("review_fix_1", "code_change", "data-scientist"),
        st("qa", "qa", "qa", ["ui"]),
        st("fix_qa_1", "code_change", "data-scientist"),
        st("old", "code_change", "qa", ["api"], "t0", NOW - 30 * DAY), // out of window
      ],
      delegations: [
        { fromRole: "data-scientist", toRole: "qa", at },
        { fromRole: "data-scientist", toRole: "qa", at },
        { fromRole: "frontend", toRole: "backend", at }, // both resolve to qa → filtered
        { fromRole: "cto", toRole: "qa", at: NOW - 40 * DAY }, // out of window
      ],
      messages: [
        { id: "m1", conversationId: "k", authorType: "agent", agentId: "d", content: "check", at, handoffFromAgentId: "q" },
      ],
    });
    const edge = (from: string, to: string) => graph.edges.find((e) => e.from === from && e.to === to);
    expect(edge("data-scientist", "qa")?.counts).toEqual({ delegation: 2, chat: 0, review_loop: 0, dependency: 2 });
    expect(edge("qa", "data-scientist")?.counts).toEqual({ delegation: 0, chat: 1, review_loop: 2, dependency: 1 });
    // Both the review pass and the QA pass depend on the UI subtask.
    expect(edge("qa", "data-scientist")?.counts.dependency).toBe(1);
    expect(edge("data-scientist", "qa")?.counts.dependency).toBe(2);
    expect(edge("data-scientist", "data-scientist")).toBeUndefined();
    expect(edge("qa", "qa")).toBeUndefined();
    expect(graph.totals).toMatchObject({ delegation: 2, chat: 1, chatInferred: 0, chatRecorded: 1, review_loop: 2, dependency: 3 });
    // Every roster role is drawn, in registry order, even without edges.
    expect(graph.nodes.map((n) => n.key)).toEqual(["qa", "data-scientist"]);
    expect(graph.edges[0]).toMatchObject({ from: "data-scientist", to: "qa", total: 4 });
  });
});

describe("aggregateAgentProfile", () => {
  test("status, success rate, durations, tokens, fixes, pass rates, verdicts, evals, recent", () => {
    const p = aggregateAgentProfile({
      now: NOW,
      sinceDays: 30,
      subtasks: [
        { taskId: "t1", key: "ui", title: "UI", kind: "code_change", status: "completed", at: NOW - DAY },
        { taskId: "t1", key: "review_fix_1", title: "Fix", kind: "code_change", status: "completed", origin: "review_fix", at: NOW - DAY + 10 },
        { taskId: "t2", key: "ui", title: "UI 2", kind: "code_change", status: "failed", at: NOW - 2 * DAY, startedAt: NOW - 2 * DAY, completedAt: NOW - 2 * DAY + 6000 },
        { taskId: "t3", key: "review", title: "Review", kind: "review", status: "completed", at: NOW - 3 * DAY },
        { taskId: "t0", key: "x", title: "Old", kind: "code_change", status: "completed", at: NOW - 90 * DAY },
      ],
      executions: [
        { taskId: "t1", subtaskKey: "ui", status: "completed", attempt: 1, startedAt: NOW - DAY, completedAt: NOW - DAY + 2000, at: NOW - DAY },
        { taskId: "t1", subtaskKey: "review_fix_1", status: "completed", attempt: 2, startedAt: NOW - DAY, completedAt: NOW - DAY + 4000, at: NOW - DAY },
        { taskId: "t3", subtaskKey: "review", status: "completed", attempt: 1, startedAt: NOW - 3 * DAY, completedAt: NOW - 3 * DAY + 1000, at: NOW - 3 * DAY },
      ],
      usage: [
        { inputTokens: 100, outputTokens: 50, estimatedCost: 0.01, at: NOW - DAY },
        { inputTokens: 10, outputTokens: 0, estimated: true, at: NOW - DAY },
        { inputTokens: 999, outputTokens: 0, at: NOW - 60 * DAY },
      ],
      verdicts: [
        { taskId: "t1", type: "review.requested_changes", at: NOW - DAY + 5 },
        { taskId: "t1", type: "review.approved", at: NOW - DAY + 20 },
        { taskId: "t2", type: "qa.passed", at: NOW - 2 * DAY },
        { taskId: "t3", type: "review.approved", at: NOW - 3 * DAY },
      ],
      evaluations: [
        { taskId: "t1", verdict: "failed", at: 1 },
        { taskId: "t1", verdict: "passed", at: 2 },
        { taskId: "t2", verdict: "inconclusive", at: 1 },
        { taskId: "t9", verdict: "passed", at: 1 },
      ],
      chatReplies: 4,
    });
    expect(p.subtasks.total).toBe(4);
    expect(p.subtasks.status).toMatchObject({ done: 3, failed: 1 });
    expect(p.subtasks.successRate).toBe(0.75);
    expect(p.duration).toMatchObject({ timedRuns: 4, medianMs: 3000, totalMs: 13000 });
    expect(p.executions).toEqual({ total: 3, retries: 1 });
    expect(p.tokens).toMatchObject({ total: 160, cost: 0.01, estimated: true, calls: 2 });
    expect(p.fixes).toBe(1);
    expect(p.reviewRuns).toBe(1);
    expect(p.workReviewed).toEqual({ tasks: 1, firstPass: 0, rate: 0 });
    expect(p.workQaed).toEqual({ tasks: 1, firstPass: 1, rate: 1 });
    expect(p.verdictsGiven.review).toEqual({ approved: 1, changesRequested: 0 });
    expect(p.evals).toEqual({ tasks: 2, passed: 1, failed: 0, inconclusive: 1 });
    expect(p.chatReplies).toBe(4);
    expect(p.recent.map((r) => `${r.taskId}/${r.key}`)).toEqual(["t1/review_fix_1", "t1/ui", "t2/ui", "t3/review"]);
    expect(p.recent[0].durationMs).toBe(4000);
  });
});

describe("load-aware routes in workload and routing", () => {
  const payload = { subtaskKey: "ui", agent: "Frontend B", role: "frontend", match: "exact", loadAware: { from: "Frontend", to: "Frontend B", fromRole: "frontend", toRole: "frontend", reason: "at capacity (1/1 running) vs 0/2" } };

  test("workload counts load-aware routes", () => {
    expect(routeLoadAware(payload)).toEqual({ fromRole: "frontend", toRole: "frontend", reason: "at capacity (1/1 running) vs 0/2" });
    expect(routeLoadAware({ subtaskKey: "x" })).toBeNull();
    const r = aggregateWorkload({
      now: NOW,
      sinceDays: 7,
      subtasks: [],
      executions: [],
      usage: [],
      messages: [],
      routes: [
        { taskId: "t1", subtaskKey: "ui", role: "frontend", match: "exact", at: NOW - 10, loadAware: routeLoadAware(payload) },
        { taskId: "t1", subtaskKey: "api", role: "backend", match: "exact", at: NOW - 5 },
      ],
    });
    expect(r.loadAware.count).toBe(1);
    expect(r.loadAware.recent[0]).toMatchObject({ taskId: "t1", subtaskKey: "ui", fromRole: "frontend" });
  });

  test("routing inspector explains a load-aware pick", () => {
    const view = extractRouting({
      events: [{ type: "subtask.routed", payload, createdAt: 1 }],
      subtasks: [{ key: "ui", title: "UI", capability: "frontend-development", kind: "code_change", dependencies: [] }],
      delegations: [],
      roleByAgentName: {},
    });
    expect(view.subtasks[0].loadAware).toMatchObject({ fromRole: "frontend" });
    expect(view.subtasks[0].why.some((w) => w.startsWith("Load-aware: moved off Assistant"))).toBe(true);
  });
});
