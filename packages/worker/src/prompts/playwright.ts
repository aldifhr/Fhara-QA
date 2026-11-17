/**
 * Prompt builders for the Playwright automation pipeline. All wording lives
 * here; callers only pass data. Every caller must apply the budget pre-call
 * gate and thread the task AbortSignal.
 */

export interface TestPlanPromptInput {
  request: string;
  repoMap?: string;
  existingTests?: string[];
}

export function testPlanPrompt(input: TestPlanPromptInput): string {
  return [
    "Turn the request into a QA test plan. Return STRICT JSON only, no prose.",
    "Schema: {\"goal\":\"one sentence\",\"assumptions\":[\"...\"],\"steps\":[{\"label\":\"short name\",\"action\":\"goto|click|fill|expectText|expectVisible\",\"target\":\"URL, button name, label or text\",\"expected\":\"only for fill/expectText\"}]}",
    "Rules:",
    "- Use only the five listed actions. target is a URL for goto, an accessible name for click/fill/expectVisible, and text for expectText.",
    "- Prefer role- and label-based locators; never invent CSS selectors or fixed sleeps.",
    "- Cover the happy path, one edge case and one failure path when the request allows it.",
    "- Keep steps independent and deterministic. Do not describe implementation work outside test files.",
    "- Quote the user's exact goal; do not add requirements they did not state.",
    ...(input.repoMap ? [`Repository map:\n${input.repoMap}`] : []),
    ...(input.existingTests?.length ? [`Existing test files:\n${input.existingTests.join("\n")}`] : []),
    `Request:\n${input.request}`,
  ].join("\n");
}

export interface SpecPromptInput {
  plan: string;
  frameworkNotes?: string;
  filePath: string;
}

export function specGenerationPrompt(input: SpecPromptInput): string {
  return [
    "Write one Playwright spec from the test plan. Return ONLY the file contents, no prose or fences.",
    `Write to ${input.filePath} (a test path). Do not change production code, package.json or config files.`,
    "Use `import { test, expect } from \"@playwright/test\";` and the repo's existing test conventions.",
    "Use role/label locators (getByRole, getByLabel, getByText); no CSS selectors, no fixed waits.",
    "Each test is independent, with its own setup. Cover only the steps in the plan.",
    ...(input.frameworkNotes ? [`Repo notes:\n${input.frameworkNotes}`] : []),
    `Test plan (JSON):\n${input.plan}`,
  ].join("\n");
}

export interface HealerPromptInput {
  specPath: string;
  failure: string;
  currentSpec: string;
}

export function healerPrompt(input: HealerPromptInput): string {
  return [
    "A generated Playwright spec failed. Return STRICT JSON: {\"kind\":\"locator|assertion|product|environment\",\"spec\":\"<corrected file contents or empty>\"}.",
    "kind is locator only when the error is about finding or resolving an element (locator, strict mode, not visible).",
    "kind is assertion when an expectation did not match; product when the app behavior is wrong; environment when the browser or runner is unavailable.",
    "Write a corrected spec ONLY for kind=locator. For every other kind return an empty spec string — never change the assertion to make it pass.",
    `Spec path: ${input.specPath}`,
    `Failure:\n${input.failure}`,
    `Current spec:\n${input.currentSpec}`,
  ].join("\n");
}
