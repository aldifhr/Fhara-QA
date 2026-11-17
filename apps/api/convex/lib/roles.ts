/**
 * Single source of truth for the team roles.
 *
 * Pure TypeScript (no Convex, Node or DOM APIs) so it can be imported by the
 * Convex backend (fixed-team seed, role registry), the web app (role menus,
 * labels, @mention chip colours — via the `@/api/convex/lib/roles` alias)
 * and the worker.
 *
 * This is the QA-only fork (plan 068). The fixed team is one QA role; CTO,
 * Frontend, Backend and Designer are retired and their aliases resolve to QA.
 */

/** Current roles, in display order. Every role menu reads this list. */
export const ROLE_KEYS = ["qa"] as const;

export type RoleKey = (typeof ROLE_KEYS)[number];

/**
 * What a role may do, enforced by the worker executor (plan 040), not only
 * by its prompt.
 *
 * - `write`: `true` = stage file changes anywhere in its subtask scope;
 *   an array = only paths matching one of these globs (`*` within a path
 *   segment, a trailing `/**` for a whole directory); `false` = never.
 * - `shell`: `"allowlist"` = any command on the worker's exact-argv
 *   allowlist; `"verify"` = only the verification commands on it (tests,
 *   typecheck, build, read-only git); `"none"` = no commands.
 * - `web`: the read-only Agent Reach web tool (`web_reach`).
 * - `push`: always false. Push / PR stay user-approved runtime steps.
 * - `options`: the `show_options` tool (lib/optionsReview.ts): ask the
 *   user to pick between options (html mockups, images, markdown
 *   trade-offs). Read-only for the repository; the subtask waits for the
 *   answer. Off for the fixed-team roles; Designer turns it on for mockup
 *   choices. Turn it on per role here when its prompt and planner rules are ready.
 *
 * Destructive or push-like commands always ask for approval for every role
 * (lib/commandRules.ts); nothing here relaxes that.
 */
export interface RolePermissions {
  read: true;
  write: boolean | readonly string[];
  shell: "none" | "verify" | "allowlist";
  web: boolean;
  push: false;
  options: boolean;
}

/**
 * Canonical successor for legacy role aliases. Stored agents and chat
 * messages may still carry old role names; this maps them to the current
 * role so the rest of the system never needs to know about the old roles.
 */
export const LEGACY_ROLE_SUCCESSORS: Readonly<Record<string, RoleKey>> = {
  cto: "qa",
  frontend: "qa",
  "front-end": "qa",
  backend: "qa",
  "back-end": "qa",
  designer: "qa",
  "ui-ux": "qa",
  ux: "qa",
  support: "qa",
  documentation: "qa",
  "technical-writer": "qa",
  writer: "qa",
  devops: "qa",
  "dev ops": "qa",
  "devops engineer": "qa",
  reviewer: "qa",
  "code-review": "qa",
  "code review": "qa",
  researcher: "qa",
  research: "qa",
  "product-analyst": "qa",
  product: "qa",
  analyst: "qa",
  "product analyst": "qa",
  lead: "qa",
  growth: "qa",
  orchestrator: "qa",
  planner: "qa",
  architect: "qa",
};

/**
 * Roles no longer in the fixed team. `syncFixedTeam` disables stored agents
 * whose normalized role is one of these, so a stale row can never be routed
 * after the roster change.
 */
export const RETIRED_ROLE_KEYS: readonly string[] = [
  "cto",
  "frontend",
  "backend",
  "designer",
  "lead",
  "growth",
  "product-analyst",
  "ui-ux",
  "support",
  "devops",
  "reviewer",
  "researcher",
];

export interface RoleDefinition {
  key: RoleKey;
  /** Short label shown in the UI and used as the seeded agent's name. */
  label: string;
  /** Long title stored on the role registry row (`roleDefinitions.name`). */
  title: string;
  category: string;
  /** Description seeded onto the fixed-team agent. */
  description: string;
  /** Description stored on the role registry row. */
  registryDescription: string;
  /**
   * Description the worker uses in planner/router prompts, when it differs
   * from `description` (falls back to `description`).
   */
  workerDescription?: string;
  /** Default capabilities seeded onto the fixed-team agent. */
  capabilities: readonly string[];
  /** Capabilities stored on the role registry row. */
  registryCapabilities: readonly string[];
  /** Default tools (agent `supportedTools` and registry `defaultTools`). */
  defaultTools: readonly string[];
  /** Enforced permissions (plan 040). `defaultTools` mirrors them. */
  permissions: RolePermissions;
  /** Fixed-team scheduling defaults. */
  priority: number;
  maxConcurrency: number;
  /** One-line responsibilities hint (mirrors the worker's systemPromptHint). */
  hint: string;
  /**
   * Stack-neutral area of expertise for conversation (personal chat). The
   * `hint` and seed prompt name this product's own stack (e.g. Convex) for
   * task execution; in chat the role talks about any stack the user uses.
   */
  chatSummary: string;
  /** Key into `AGENT_SEED_PROMPTS` (lib/prompts/agents.ts). */
  defaultPromptKey: RoleKey;
  /** @mention chip classes (full strings so Tailwind picks them up). */
  color: string;
}

export const ROLES: Record<RoleKey, RoleDefinition> = {
  qa: {
    key: "qa",
    label: "Assistant",
    title: "Assistant",
    category: "Automation",
    description: "Runs the QA automation pipeline: test plans, generated specs, execution and healing.",
    registryDescription: "Runs the QA automation pipeline: test plans, generated specs, execution and healing.",
    workerDescription: "Test planning, spec generation, execution and quality verification.",
    capabilities: ["browser-testing", "code-review"],
    registryCapabilities: ["browser-testing", "code-review"],
    defaultTools: ["read_file", "write_file", "run_command"],
    permissions: {
      read: true,
      write: ["tests/**", "e2e/**", "**/*.test.*", "**/*.spec.*", "**/__tests__/**", "playwright.config.*"],
      shell: "verify",
      web: false,
      push: false,
      options: false,
    },
    priority: 7,
    maxConcurrency: 2,
    hint: "Run the QA automation pipeline: plan checks, write specs only in test paths, execute them, and report evidence. Never fabricate results; defects go back to the owner.",
    chatSummary: "Test automation: test plans, generated specs, execution, bug findings and verification.",
    defaultPromptKey: "qa",
    color: "bg-orange-500/10 text-orange-700 ring-orange-500/20 dark:bg-orange-500/20 dark:text-orange-300",
  },

};

/**
 * Order the fixed-team sync seeds agents in (and appends them to a
 * project's `agentIds`). One agent in this fork.
 */
export const FIXED_TEAM_SEED_ORDER: readonly RoleKey[] = ["qa"];

/** The fixed team as the sidebar and Team list show it, top to bottom. */
export const FIXED_TEAM_DISPLAY_ORDER: readonly RoleKey[] = ["qa"];

/** "product-analyst" → "Product Analyst": the label for a key with no role row. */
function titleCaseRoleKey(key: string): string {
  return key
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/**
 * Capabilities a stored agent must no longer carry after the roster change.
 * Only these are removed; capabilities a user added by hand are kept.
 */
export const REVOKED_DEFAULT_CAPABILITIES: Readonly<Record<string, readonly string[]>> = {
  cto: ["code-review", "security-audit", "project-coordination"],
  frontend: ["frontend-development", "ui-ux-design"],
  backend: ["backend-development", "code-review", "security-audit", "documentation-support"],
  designer: ["ui-ux-design"],
};

/** Permissions for a fixed role key (null for an unknown/custom role). */
export function rolePermissionsFor(role: string | undefined): RolePermissions | null {
  const raw = normalizeRoleKey(role);
  const key: string = LEGACY_ROLE_SUCCESSORS[raw] ?? raw;
  return isRoleKey(key) ? ROLES[key].permissions : null;
}

/**
 * Permissions for a custom role (not one of the four): derived from the
 * row's declared tools, which is what such an agent could do before
 * plan 040. Never grants push.
 */
export function permissionsFromTools(supportedTools: readonly string[] | undefined): RolePermissions {
  const tools = new Set(supportedTools ?? []);
  return {
    read: true,
    write: tools.has("write_file"),
    shell: tools.has("run_command") ? "allowlist" : "none",
    web: tools.has("web_reach"),
    push: false,
    options: tools.has("show_options"),
  };
}

function globToRegExp(glob: string): RegExp {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === "*" && glob[i + 1] === "*") {
      // "**/" matches zero or more directories; a trailing "**" anything.
      if (glob[i + 2] === "/") {
        out += "(?:.*/)?";
        i += 2;
      } else {
        out += ".*";
        i += 1;
      }
    } else if (ch === "*") {
      out += "[^/]*";
    } else if (ch === "?") {
      out += "[^/]";
    } else {
      out += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${out}$`);
}

/**
 * Whether `permissions` let the role write `filePath` (repo-relative).
 *
 * The malformed-path check runs before the role's own grant: `write: true`
 * means "anywhere in the worktree", not "anywhere". A path that climbs above
 * the workspace root is refused for every role, writer included.
 */
export function canWritePath(permissions: RolePermissions, filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/").replace(/^\.\//, "");
  if (!normalized || normalized.split("/").includes("..")) return false;
  if (permissions.write === true) return true;
  if (permissions.write === false) return false;
  return permissions.write.some((glob) => globToRegExp(glob).test(normalized));
}

/**
 * Whether an agent of this role writes code in tasks (Frontend or Backend;
 * a custom role with write_file). Chat write requests addressed to such an
 * agent are offered as a task routed to it.
 */
export function isCodeWritingRole(role: string | undefined, supportedTools?: readonly string[]): boolean {
  const perms = rolePermissionsFor(role) ?? (supportedTools ? permissionsFromTools(supportedTools) : null);
  return Boolean(perms && perms.write !== false);
}

/** "Product Analyst", "product_analyst", "UI/UX" → "product-analyst", "ui-ux". */
export function normalizeRoleKey(role: string | undefined): string {
  return (role ?? "").trim().toLowerCase().replace(/[\s_\/]+/g, "-");
}

export function isRoleKey(value: string): value is RoleKey {
  return (ROLE_KEYS as readonly string[]).includes(value);
}

/** Role key for a mention like "@QA" / "@frontend", or null if unknown. */
export function roleKeyForMention(mention: string): RoleKey | null {
  const raw = mention.replace(/^@/, "").trim().toLowerCase();
  if (!raw) return null;
  if (isRoleKey(raw)) return raw;
  if (LEGACY_ROLE_SUCCESSORS[raw]) return LEGACY_ROLE_SUCCESSORS[raw];
  const byLabel = ROLE_KEYS.find((key) => ROLES[key].label.toLowerCase() === raw);
  return byLabel ?? null;
}

/** Stack-neutral chat area for a role (null for an unknown/custom role). */
export function roleChatSummary(role: string | undefined): string | null {
  const raw = normalizeRoleKey(role);
  const key: string = LEGACY_ROLE_SUCCESSORS[raw] ?? raw;
  if (isRoleKey(key)) return ROLES[key].chatSummary;
  const byLabel = ROLE_KEYS.find((k) => ROLES[k].label.toLowerCase() === raw);
  return byLabel ? ROLES[byLabel].chatSummary : null;
}

/** Role label for a role key, e.g. "frontend" -> "Frontend". */
export function roleLabel(role: string | null | undefined): string {
  const raw = (role ?? "").trim().toLowerCase();
  if (!raw) return "Agent";
  const key: string = LEGACY_ROLE_SUCCESSORS[raw] ?? raw;
  if (isRoleKey(key)) return ROLES[key].label;
  return titleCaseRoleKey(key);
}
