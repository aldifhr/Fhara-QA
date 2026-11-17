import { test } from "node:test";
import assert from "node:assert/strict";
import { prefillPromptForRole, roleTemplateFor } from "../../../api/convex/lib/prompts/roleTemplate.ts";
import { ROLE_PROMPT_TEMPLATES } from "../../../api/convex/lib/prompts/rolePrompts.data.ts";

test("picking a role in the create form prefills its role template", () => {
  // Plan 068: the only role is QA ("Assistant").
  assert.equal(prefillPromptForRole("", "qa"), ROLE_PROMPT_TEMPLATES.qa);
  assert.equal(roleTemplateFor("qa"), ROLE_PROMPT_TEMPLATES.qa);
  // A retired name prefills the role that does the work now.
  assert.equal(prefillPromptForRole("", "designer"), ROLE_PROMPT_TEMPLATES.qa);
  assert.equal(prefillPromptForRole("", "frontend"), ROLE_PROMPT_TEMPLATES.qa);
});

test("an untouched template keeps its role template but typed instructions are kept", () => {
  assert.equal(prefillPromptForRole(ROLE_PROMPT_TEMPLATES.qa, "qa"), ROLE_PROMPT_TEMPLATES.qa);
  assert.equal(prefillPromptForRole("Only review SQL.", "qa"), "Only review SQL.");
  assert.equal(prefillPromptForRole(ROLE_PROMPT_TEMPLATES.qa, null), "");
});

test("a custom role has no template", () => {
  assert.equal(roleTemplateFor("data-wrangler"), null);
  assert.equal(prefillPromptForRole("", "data-wrangler"), "");
});

test("no current text at all is treated as an empty template", () => {
  assert.equal(prefillPromptForRole(undefined, "qa"), ROLE_PROMPT_TEMPLATES.qa);
  assert.equal(prefillPromptForRole(null, null), "");
});
