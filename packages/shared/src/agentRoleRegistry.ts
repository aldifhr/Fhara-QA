/**
 * Fixed agent role registry: prompt, write scope and routing keywords.
 *
 * Lives in shared so provider adapters can inject the same instructions the
 * server registry defines. This fork has one agent; `qa` is the internal
 * permission key, not a user-facing role label (plan 068).
 */
import { type AgentRoleId } from "@fhara/contracts";

const SHARED_RULES = `
## Shared rules
- Work only on the task you were given. If it is unclear, state your assumption and proceed.
- Stay inside your write scope. If the task needs changes outside it, stop and report which files and why.
- Prefer small, reviewable changes. Do not reformat or rename code you were not asked to touch.
- Never commit secrets, tokens or credentials. Never weaken auth or validation to make something pass.
- When you finish, report: what you changed (files), how you verified it, and anything left open.
`.trim();

const QA_PROMPT = `
# QA automation assistant

You own the quality-automation pipeline for this repository.

## Write scope
- tests/**, e2e/**, **/*.test.*, **/*.spec.*, **/__tests__/**, playwright.config.*

## Responsibilities
- Turn the request into a concrete test plan: checks, preconditions, steps, expected results.
- Generate executable test specs from that plan using the framework already present in the repo.
- Execute the narrowest relevant checks first, then expand when failures justify it.
- Classify failures honestly: a broken locator is a test defect, a failing assertion is a product finding, a missing browser is an environment block.
- Keep tests deterministic: no real network, fixed clocks and seeds, isolated state.
- Never silence a failing test: no weakening, skipping or deleting to get green.

## How to work
- Use the test framework and helpers already in the repo; do not add a runner the repo does not use.
- Test behaviour through public interfaces, not implementation details.
- Report only checks you actually executed, with commands and results. Never fabricate evidence.
- Product bugs go back to the owner with a minimal reproduction, not a production-code edit.

## Output
- The test plan, the specs written, the run command and the pass/fail result.
- Findings with severity, evidence and reproduction steps.

${SHARED_RULES}
`.trim();

export const ROLE_IDS = ["qa"] as const;

export type RoleId = (typeof ROLE_IDS)[number];

export interface Role {
  readonly id: RoleId;
  readonly displayName: string;
  readonly description: string;
  readonly systemPrompt: string;
  readonly writeScope: ReadonlyArray<string>;
  readonly readOnly: boolean;
  readonly keywords: ReadonlyArray<string>;
}

export const ROLES: ReadonlyArray<Role> = [
  {
    id: "qa",
    displayName: "Assistant",
    description: "Runs the QA automation pipeline: test plans, generated specs, execution and healing.",
    systemPrompt: QA_PROMPT,
    writeScope: ["tests/**", "e2e/**", "**/*.test.*", "**/*.spec.*", "**/__tests__/**", "playwright.config.*"],
    readOnly: false,
    keywords: ["test", "tests", "testing", "qa", "vitest", "e2e", "regression", "coverage", "playwright"],
  },
];

const ROLES_BY_ID: ReadonlyMap<RoleId, Role> = new Map(ROLES.map((role) => [role.id, role]));

export function isRoleId(value: string): value is RoleId {
  return (ROLE_IDS as ReadonlyArray<string>).includes(value);
}

export function getRole(id: RoleId): Role {
  const role = ROLES_BY_ID.get(id);
  if (!role) throw new Error(`Unknown role: ${id}`);
  return role;
}

export function findRole(id: string): Role | undefined {
  return isRoleId(id) ? ROLES_BY_ID.get(id) : undefined;
}

/** Instructions the single agent adds to its provider turns. */
export const roleInstructions = (role: AgentRoleId | null | undefined): string | undefined => {
  if (role === null || role === undefined) return undefined;
  const entry = ROLES.find((candidate) => candidate.id === role);
  return entry?.systemPrompt.trim();
};
