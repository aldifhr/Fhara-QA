/**
 * Personal chat tone: a personal chat with no project is for brainstorming,
 * technical discussion, learning and general help. Seen in the app: asked
 * "kamu cuma bisa convex?", an agent recited its task boundaries and pushed
 * "attach project-nya". The project prompt and the attached personal chat keep
 * the repo grounding rule.
 *
 * Plan 068 fork: the roster is QA-only, so the agent is the "Assistant" (qa).
 */
import { describe, expect, test } from "vitest";
import {
  buildChatPersonaLines,
  buildGroundingGuidance,
  buildPersonalChatSystem,
  buildPersonalModeSection,
  buildPlanningGuidance,
  isSeedPersonaPrompt,
} from "./lib/prompts/chat";
import { AGENT_SEED_PROMPTS } from "./lib/prompts/agents";
import { ROLES, ROLE_KEYS, roleChatSummary } from "./lib/roles";

const qa = { name: "Assistant", role: "qa", systemPrompt: AGENT_SEED_PROMPTS.qa };

/** The personal-path system prompt as chat.ts assembles it (no tools). */
function personalSystem(agent: typeof qa, projectName: string | null, repoSnapshot: string | null = null): string {
  return [
    ...buildPersonalChatSystem(agent, { projectName, repoSnapshot, repoTools: false }),
    ...(projectName ? buildGroundingGuidance(false) : []),
  ].join("\n");
}

describe("personal chat with no project", () => {
  const system = personalSystem(qa, null);

  test("answers broadly: personal-mode section, stack-neutral area, user's language", () => {
    expect(system).toContain("## Personal chat");
    expect(system).toContain("brainstorming, technical discussion, learning, questions and general help");
    expect(system).toContain(ROLES.qa.chatSummary);
    expect(system).toContain("any language, framework or stack");
    expect(system).toContain("in the user's language");
  });

  test("no grounding rule and no 'haven't checked' / attach nag by default", () => {
    expect(system).not.toContain("Grounding rule");
    expect(system).not.toContain("belum saya cek");
    expect(system).not.toContain("I haven't checked");
    expect(system).not.toContain("If the user asks for work on code, say they can attach a project");
    // Attach is mentioned only as the conditional answer to a question about their own code.
    expect(system).toMatch(/Do not mention the repo, attaching a project, or that you have not checked anything, unless the user asks about their own code/);
  });

  test("no boundary recital: the unedited seed persona is left out", () => {
    expect(system).not.toContain("Never modify application code to make a test pass");
    expect(system).not.toContain("Write only test paths");
    expect(system).toContain("Never recite your scope, boundaries or what you are not, unless the user asks what you can't do.");
    expect(system).toContain("limit what you DO in tasks (writing code, running commands), not what you can talk about");
  });

  test("a persona the user edited is kept", () => {
    const edited = { ...qa, systemPrompt: "You are my Go test mentor. Prefer table-driven tests." };
    expect(personalSystem(edited, null)).toContain("You are my Go test mentor");
  });

  test("teammate suggestion is one short line, no @mention pull-in", () => {
    expect(system).toContain("name that role (without @) in one short line");
    expect(system).not.toContain("Never hand the question to a teammate");
  });

  test("no tools: never a tool call; with the skill tool that line is left to the skill protocol", () => {
    expect(buildPersonalModeSection(qa)).toContain("never output a tool call or JSON");
    expect(buildPersonalModeSection(qa, { skillTool: true })).not.toContain("never output a tool call");
  });
});

describe("attached personal chat", () => {
  test("keeps the repo grounding rule and the persona, no personal-mode section", () => {
    const system = personalSystem(qa, "Fhara", "apps/\npackages/");
    expect(system).toContain('attached to project "Fhara"');
    expect(system).toContain("Grounding rule");
    expect(system).toContain("never what they contain");
    expect(system).toContain(AGENT_SEED_PROMPTS.qa);
    expect(system).not.toContain("## Personal chat");
  });
});

describe("project chat prompt is unchanged", () => {
  test("Assistant (QA), no tools", () => {
    const system = [
      ...buildChatPersonaLines(qa, "Fhara", [], "apps/\npackages/", false),
      ...buildPlanningGuidance(qa, {
        isOrchestrator: false,
        hasRepoTools: false,
        taskIntent: { kind: "ask", frontend: false, backend: false, testing: true, security: false },
      }),
      ...buildGroundingGuidance(false),
    ]
      .filter(Boolean)
      .join("\n");
    expect(system).not.toContain("## Personal chat");
    expect(system).toContain(AGENT_SEED_PROMPTS.qa);
    expect(system).toMatchSnapshot();
  });
});

describe("roles", () => {
  test("every role has a stack-neutral chat summary; the worker hint is untouched", () => {
    expect(ROLE_KEYS).toEqual(["qa"]);
    for (const key of ROLE_KEYS) {
      expect(ROLES[key].chatSummary.length).toBeGreaterThan(10);
      expect(ROLES[key].chatSummary).not.toMatch(/convex/i);
    }
    // Retired role names resolve to the QA successor.
    expect(roleChatSummary("Backend")).toBe(ROLES.qa.chatSummary);
    expect(roleChatSummary("backend")).toBe(ROLES.qa.chatSummary);
    expect(roleChatSummary("Security")).toBeNull();
    expect(ROLES.qa.hint).toContain("write specs only in test paths");
  });

  test("seed detection", () => {
    expect(isSeedPersonaPrompt("qa", AGENT_SEED_PROMPTS.qa)).toBe(true);
    expect(isSeedPersonaPrompt("Backend", AGENT_SEED_PROMPTS.qa)).toBe(true);
    expect(isSeedPersonaPrompt("qa", "custom")).toBe(false);
    expect(isSeedPersonaPrompt("qa", undefined)).toBe(false);
  });
});
