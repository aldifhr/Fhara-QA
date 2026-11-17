/**
 * The generated apps/api/convex/lib/prompts/rolePrompts.data.ts must match
 * apps/api/convex/lib/prompts/roles/<ROLE>.md (run `npm run prompts:roles`
 * after editing one), and the seeds must use those templates.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { ROLE_KEYS, type RoleKey } from "@/api/convex/lib/roles";
import { ROLE_PROMPT_FILES, normalizeRolePrompt, renderRolePromptData } from "@/api/convex/lib/prompts/rolePromptSource";
import { ROLE_PROMPT_TEMPLATES } from "@/api/convex/lib/prompts/rolePrompts.data";
import { AGENT_SEED_PROMPTS } from "@/api/convex/lib/prompts/agents";

const ROOT = resolve(__dirname, "../../..");
const DIR = join(ROOT, "apps/api/convex/lib/prompts/roles");
const read = (key: RoleKey) => readFileSync(join(DIR, ROLE_PROMPT_FILES[key]), "utf8");

describe("role prompt templates", () => {
  test("generated data is up to date with the markdown", () => {
    const sources = Object.fromEntries(ROLE_KEYS.map((key) => [key, read(key)])) as Record<RoleKey, string>;
    const generated = readFileSync(join(ROOT, "apps/api/convex/lib/prompts/rolePrompts.data.ts"), "utf8");
    expect(generated).toBe(renderRolePromptData(sources));
  });

  test("every markdown file belongs to a role", () => {
    const files = readdirSync(DIR).filter((name) => name.endsWith(".md")).sort();
    for (const file of Object.values(ROLE_PROMPT_FILES)) expect(files).toContain(file);
  });

  test.each(ROLE_KEYS)("the %s seed is its template", (key) => {
    expect(AGENT_SEED_PROMPTS[key]).toBe(normalizeRolePrompt(read(key)));
    expect(ROLE_PROMPT_TEMPLATES[key]).toBe(AGENT_SEED_PROMPTS[key]);
  });

  test.each(ROLE_KEYS)("the %s template reports only its own part and stays persona-free", (key) => {
    const text = ROLE_PROMPT_TEMPLATES[key];
    expect(text).toMatch(/report only your own work|only your own|own part|own subtask|own review/i);
    expect(text).not.toMatch(/lazy senior/i);
  });

  test("qa states its test-path-only write boundary", () => {
    expect(ROLE_PROMPT_TEMPLATES.qa).toMatch(/Write only test paths/);
    expect(ROLE_PROMPT_TEMPLATES.qa).toMatch(/Never modify application code/);
  });

  test("qa describes spec generation and evidence in its own scope", () => {
    expect(ROLE_PROMPT_TEMPLATES.qa).toMatch(/Generate executable test specs/);
    expect(ROLE_PROMPT_TEMPLATES.qa).toMatch(/Report only tests and checks that were actually executed/);
  });
});
