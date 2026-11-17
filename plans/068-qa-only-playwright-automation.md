# Plan 068 — QA-only fork with Playwright automation

Status: IN PROGRESS (Phase 0 + automation core + threads/auto-run landed)
Priority: P1
Size: L
Surface: backend, worker, web, contracts/shared

## Goal

Make this fork a QA-only product: one QA agent, no CTO / Frontend / Backend /
Designer, and a Playwright test-automation lifecycle:

```
repo → test plan → generated spec → playwright test --reporter=json → healer → maintained specs
```

Automation is the first delivery target. Chat/delegation is reduced to the QA
role but is not a new product feature.

## Decisions

| # | Decision | Why |
| --- | --- | --- |
| D1 | Keep the orchestrator, budget gate, approval gate, sandbox, worker and Convex machinery; change only the roster, prompts and QA stage | Preserves existing invariants |
| D2 | CTO/Frontend/Backend/Designer are retired: `ROLE_KEYS` → `["qa"]`, their aliases resolve to `qa`, `syncFixedTeam` disables stored agents with retired roles | No dead agent can be routed |
| D3 | QA write scope becomes test paths only: `tests/**`, `e2e/**`, `**/*.test.*`, `**/*.spec.*`, `**/__tests__/**`, `playwright.config.*` | The generator must write specs; outside test paths stays refused |
| D4 | QA shell stays `verify`, but the exact-argv allowlist and the verify-command predicate gain `npx playwright test --reporter=json` | One exact argv pair, never a prefix; no blanket permission |
| D5 | Generated specs and healer edits stay behind `apply_changes` / `run_command` approval | Non-negotiable #5; no auto-approval added |
| D6 | Healer classification: locator/timeout failure → regenerate the spec; assertion or app defect → finding for the owner; environment failure → `blocked` | A green suite must not hide a bug |
| D7 | `@playwright/test` stays a dependency of the target repo; the worker's `playwright` library only drives Chromium | No runner version pinned into user projects |
| D8 | New persisted state is additive: optional fields only, no column drops, new table with `by_task`/`by_project` indexes | Non-negotiable #7 |
| D9 | One agent, no user-facing role labels: `qa` is only an internal permission key; display name is "Assistant" and UI role captions are suppressed | Owner decision after D1–D8 |
| D10 | Threads, not tasks, are the product unit: one project owns many QA threads; `conversations.createThread` is the public creation path and the composer posts to the selected `conversationId` | Owner decision |
| D11 | Work-shaped messages start automatically in the same turn: default composer mode is `auto_edits`; no CTO wrap-up or "Create task" offer. Push/PR and destructive steps keep their approval gate | Owner decision |
| D12 | Inbox and Personal Messages are removed from this fork (routes, nav, command entries) | Owner decision |
| D13 | The Library Templates tab and the account stub row in the sidebar are removed | Owner decision |
| D14 | **Sandbox removed** (owner decision): file tools no longer reject absolute/`..` paths and commands are no longer wrapped in `bwrap`. Forbidden-file checks (`.env`, credentials, another task's workspace), the exact-argv allowlist and every approval gate stay. This changes non-negotiable #4's sandboxing clause; recorded here explicitly | Owner decision |
| D15 | **No project membership**: `projects.agentIds` is legacy-only and is no longer written or read; every enabled agent is available to every project, and the UI has no "add agent to project" controls | Owner decision |

## Steps (ordered, each ends in a compiling state)

### Phase 0 — QA-only roster

1. `apps/api/convex/lib/roles.ts`: ROLE_KEYS/ROLES/FIXED_TEAM_* → QA; add
   `RETIRED_ROLE_KEYS`; all legacy aliases → QA; QA permissions per D3/D4.
2. `apps/api/convex/agents.ts:syncFixedTeam`: disable retired-role agents once
   (`retiredAt`), only for roles in `RETIRED_ROLE_KEYS`.
3. `packages/contracts/src/agentRoles.ts`: ids + summaries → QA only.
4. `packages/shared/src/agentRoleRegistry.ts`: QA-only prompt; drop the CTO
   delegation playbook.
5. Role prompt sources: keep QA.md, regenerate `rolePrompts.data.ts`.
6. Enforced maps: `planEdit.ts`, `opencodePermissions.ts`, `rolePolicy.ts`,
   `builtinSkills.ts`, `agentTemplates.ts`, `review/showOptions.ts`.
7. Worker/backend prompts: `prompts/planner.ts`, `prompts/fix.ts`,
   `prompts/codeChange.ts`, `lib/prompts/chat.ts`, `lib/chat/dispatch.ts`,
   `lib/chat/taskAssignees.ts`, `decisionTurns.ts`.
8. Update roster tests to QA-only expectations (no test deleted).

### Phase 1 — automation core (pure, unit-tested)

9. `packages/worker/src/prompts/playwright.ts`: test-plan and spec-generation
   prompt builders; `src/utils/playwrightAutomation.ts`: pure parse of
   `--reporter=json` into `QaCheck[]`, failure classification, spec rendering.
10. `packages/worker/tests/playwrightAutomation.test.ts`: parse, locator vs
    assertion vs environment, no-test-found, malformed JSON, abort-safe data.
11. Budget gate (`budget.ts:assertLlmCallAllowed`) called before every new LLM
    stage; `signal` threaded through.

### Phase 2 — spec generation + execution wiring

12. `commandAllowlist.ts` + `rolePolicy.ts:VERIFY_COMMANDS`: exact argv from D4.
13. QA node in `execution/qa.ts` accepts a `QaTestPlan`/spec paths, runs
    Playwright with the JSON reporter, parses results into `QaCheck[]`.
14. Planner node instructions produce: plan → generate spec (code_change in
    test paths) → run QA node. App fixes still route to the owner.

### Phase 3 — healer + persistence

15. Failure classification feeds `decideFixOwner` / `qaLoop`: locator →
    regenerate spec (bounded by `maxReviewIterations`), product bug → finding,
    environment → `blocked`. Emit `qa.playwright.*` through `logEvent`.
16. Optional additive `qaTestPlans` table + token-gated worker action only if
    the plan must survive a worker restart; otherwise keep the plan on the task
    document as an optional field.

## Invariants

- Sandbox path resolution and exact-argv matching unchanged.
- `apply_changes`, `run_command`, `git_push`, `merge_pr` approvals unchanged.
- Terminal-status guard unchanged.
- Every LLM call preceded by the budget gate.
- Observability through `taskEvents` only.
- No schema column dropped; stored legacy roles remain readable.

## Completion criteria

- [ ] A fresh deployment seeds exactly one QA agent; old CTO/Frontend/Backend agents are disabled.
- [ ] `npm run --workspace=@fhara/api test` green.
- [ ] `npm test` (worker) green.
- [ ] `npm run --workspace=@fhara/web test` green.
- [ ] Narrow typechecks green after codegen.
- [ ] A generated spec can be staged (approval required) and executed through the exact-argv allowlist.
- [ ] A locator-only failure is healed; an assertion failure is reported, not silenced.

## STOP conditions

- A rule in `AGENTS.md` must change beyond D3/D4 as recorded.
- The healer would need to approve its own changes.
- A check fails twice after a reasonable fix.
- Work is needed outside this repository.
