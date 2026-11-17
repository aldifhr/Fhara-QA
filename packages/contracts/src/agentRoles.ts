import * as Schema from "effect/Schema";

/**
 * Display summary of the fixed agent roles (no prompts). This fork has one
 * agent: CTO, Frontend, Backend and Designer are retired (plan 068).
 */
export const AGENT_ROLE_IDS = ["qa"] as const;
export type AgentRoleId = (typeof AGENT_ROLE_IDS)[number];

/** Wire schema for the fixed role ids. */
export const AgentRoleIdSchema = Schema.Literals(AGENT_ROLE_IDS);

/** Wire id of a user-created agent, always namespaced under `custom:`. */
export const CustomAgentId = Schema.String.check(Schema.isPattern(/^custom:\S+$/));
export type CustomAgentId = typeof CustomAgentId.Type;

/** A role reference: a fixed role id or a custom agent id. */
export const AgentRoleRefSchema = Schema.Union([AgentRoleIdSchema, CustomAgentId]);
export type AgentRoleRef = typeof AgentRoleRefSchema.Type;

export interface AgentRoleSummary {
  readonly id: AgentRoleId;
  readonly displayName: string;
  readonly description: string;
  readonly readOnly: boolean;
  readonly writeScope: ReadonlyArray<string>;
}

export const AGENT_ROLE_SUMMARIES = [
  {
    id: "qa",
    displayName: "Assistant",
    description: "Runs the QA automation pipeline: test plans, generated specs, execution and healing.",
    readOnly: false,
    writeScope: ["tests/**", "e2e/**", "**/*.test.*", "**/*.spec.*", "**/__tests__/**", "playwright.config.*"],
  },
] as const satisfies ReadonlyArray<AgentRoleSummary>;
