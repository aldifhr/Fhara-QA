import { ROLES } from "@/api/convex/lib/roles";
import { CAPABILITY, type AgentDefinition } from "@/types";

/**
 * Pure agent → capability resolution (declared capabilities, else the
 * role-name heuristic). No routing or availability logic: that stays in
 * orchestrator/capabilities, which re-exports these.
 *
 * This fork has one agent. Every legacy role name resolves to the same
 * capability set through `LEGACY_ROLE_SUCCESSORS`; the extra patterns below
 * are worker-only heuristics for free-text agent names.
 */
const ROLE_CAPABILITIES: Array<{ pattern: RegExp; capabilities: string[] }> = [
  {
    pattern: /\b(qa|test|testing|quality|e2e|cto|architect|designer|frontend|backend|support|researcher|reviewer)\b/i,
    capabilities: [...ROLES.qa.registryCapabilities],
  },
  {
    pattern: /\b(security|audit|pentest|appsec)\b/i,
    capabilities: [CAPABILITY.SECURITY],
  },
  {
    pattern: /\b(github|git|pr|pull request|issue|repo)\b/i,
    capabilities: [CAPABILITY.GITHUB, CAPABILITY.SHELL_EXECUTION],
  },
  {
    pattern: /\b(shell|terminal|exec|command|run|bash)\b/i,
    capabilities: [CAPABILITY.SHELL_EXECUTION],
  },
];

export function normalizeCapability(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "-");
}

export function capabilityForRole(role: string): string[] {
  const normalized = role.trim();
  if (!normalized) return [CAPABILITY.GENERAL];
  for (const entry of ROLE_CAPABILITIES) {
    if (entry.pattern.test(normalized)) return entry.capabilities;
  }
  return [normalizeCapability(normalized), CAPABILITY.GENERAL];
}

export function capabilitiesOf(agent: AgentDefinition): string[] {
  const declared = (agent.capabilities ?? [])
    .map(normalizeCapability)
    .filter((capability) => capability.length > 0);
  if (declared.length > 0) return Array.from(new Set(declared));
  return Array.from(new Set(capabilityForRole(agent.role)));
}
