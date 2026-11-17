/**
 * Pure helpers for the Playwright automation pipeline (plan → spec → run →
 * heal). No Node APIs, no shell, no LLM: this module is safe to import from
 * any worker layer and to unit-test without a browser.
 */
import type { QaCheck } from "@/types/qa";

export type PlaywrightFailureKind = "locator" | "assertion" | "timeout" | "environment" | "unknown";

export type QaTestAction = "goto" | "click" | "fill" | "expectText" | "expectVisible";

export interface QaTestStep {
  readonly label: string;
  readonly action: QaTestAction;
  /** URL, role name or text depending on the action. */
  readonly target: string;
  /** Expected text for expectText, or value for fill. */
  readonly expected?: string;
}

export interface QaTestPlan {
  readonly goal: string;
  readonly steps: readonly QaTestStep[];
  readonly assumptions?: readonly string[];
}

export interface PlaywrightResult {
  readonly title: string;
  readonly file?: string;
  readonly line?: number;
  readonly status: "passed" | "failed" | "skipped";
  readonly error?: string;
  readonly durationMs?: number;
}

const MAX_RESULTS = 500;
const MAX_ERROR_CHARS = 4_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function trimText(value: unknown, limit: number): string | undefined {
  if (typeof value !== "string") return undefined;
  return value.length > limit ? `${value.slice(0, limit)}…` : value;
}

/**
 * Flatten the `@playwright/test --reporter=json` tree into results.
 * Malformed input yields an empty list rather than throwing: a broken report
 * is a finding, not a crash.
 */
export function parsePlaywrightReport(raw: unknown): PlaywrightResult[] {
  const out: PlaywrightResult[] = [];
  const root = isRecord(raw) ? raw : {};
  const visitSuites = (value: unknown, fileHint?: string, depth = 0) => {
    if (depth > 12 || out.length >= MAX_RESULTS || !Array.isArray(value)) return;
    for (const suite of value) {
      if (!isRecord(suite) || out.length >= MAX_RESULTS) continue;
      const file = typeof suite.file === "string" ? suite.file : fileHint;
      if (Array.isArray(suite.suites)) visitSuites(suite.suites, file, depth + 1);
      if (!Array.isArray(suite.specs)) continue;
      for (const spec of suite.specs) {
        if (!isRecord(spec) || out.length >= MAX_RESULTS) continue;
        const specFile = typeof spec.file === "string" ? spec.file : file;
        const line = typeof spec.line === "number" ? spec.line : undefined;
        if (!Array.isArray(spec.tests)) continue;
        for (const test of spec.tests) {
          if (!isRecord(test) || out.length >= MAX_RESULTS) continue;
          const results = Array.isArray(test.results) ? test.results : [];
          const title = [suite.title, spec.title, test.title]
            .filter((part): part is string => typeof part === "string" && part.length > 0)
            .join(" › ") || "unnamed spec";
          if (results.length === 0) {
            out.push({ title, file: specFile, line, status: "skipped" });
            continue;
          }
          for (const result of results) {
            if (out.length >= MAX_RESULTS) break;
            if (!isRecord(result)) continue;
            const status = result.status === "passed" || result.status === "skipped" ? result.status : "failed";
            const errorRecord = isRecord(result.error) ? result.error : undefined;
            const error = trimText(
              errorRecord?.message ?? result.error,
              MAX_ERROR_CHARS
            );
            out.push({
              title,
              file: specFile,
              line,
              status,
              ...(error ? { error } : {}),
              ...(typeof result.duration === "number" ? { durationMs: result.duration } : {}),
            });
          }
        }
      }
    }
  };
  visitSuites(root.suites);
  return out;
}

/** Classify a spec failure. Locator-shaped messages win over generic timeouts. */
export function classifyPlaywrightFailure(result: PlaywrightResult): PlaywrightFailureKind {
  if (result.status !== "failed") return "unknown";
  const message = (result.error ?? "").toLowerCase();
  if (/executable doesn't exist|browserType\.launch|econnrefused|eaddrinuse|cannot find module|no tests found/i.test(message)) {
    return "environment";
  }
  if (/locator|strict mode violation|element is not visible|waiting for selector|getbyrole|getbytext|getbylabel|getbytestid/i.test(message)) {
    return "locator";
  }
  if (/timed out|timeout .* exceeded/i.test(message)) return "timeout";
  if (/\bexpect\(|\bexpected\b|assertion failed|\btoBe\b|\btoEqual\b|tohavetext/i.test(message)) return "assertion";
  return "unknown";
}

/** What the runner does with a classified spec failure. */
export type PlaywrightFixAction = "heal_spec" | "report_product" | "block_environment";

export function playwrightFixAction(kind: PlaywrightFailureKind): PlaywrightFixAction {
  if (kind === "locator" || kind === "timeout") return "heal_spec";
  if (kind === "environment") return "block_environment";
  return "report_product";
}

/** QA findings carry the classifier marker in their description. */
export function isSpecHealingFinding(description: string): boolean {
  return /failure kind: (locator|timeout)/.test(description);
}

/** Map parsed results onto the existing QA check shape used by the runner. */
export function qaChecksFromPlaywright(results: readonly PlaywrightResult[]): QaCheck[] {
  return results.map((result) => {
    const location = result.file ? `${result.file}${result.line !== undefined ? `:${result.line}` : ""}` : "spec";
    const status = result.status === "passed" ? "passed" : result.status === "skipped" ? "inconclusive" : "failed";
    const kind = classifyPlaywrightFailure(result);
    return {
      label: `${location} · ${result.title}`,
      objective: `Run the generated spec: ${result.title}`,
      steps: [`npx playwright test --reporter=json`],
      expected: "The spec passes",
      actual: result.error ? `${result.status}: ${result.error}` : result.status,
      evidence: kind === "unknown" ? undefined : `failure kind: ${kind}`,
      details: kind === "unknown" ? undefined : `failure kind: ${kind}`,
      status,
      ...(result.file ? { filePath: result.file } : {}),
    };
  });
}

/**
 * Render a deterministic spec from a validated plan. Only allowlisted actions
 * are emitted; values are JSON-encoded so LLM text cannot inject code.
 */
export function specSourceFromPlan(plan: QaTestPlan, specName = "generated"): string {
  const lines = [
    "// Generated by the QA automation pipeline. Review before committing.",
    `import { test, expect } from "@playwright/test";`,
    "",
    `test.describe(${JSON.stringify(plan.goal || specName)}, () => {`,
  ];
  for (const step of plan.steps) {
    const label = JSON.stringify(step.label || step.action);
    lines.push(`  test(${label}, async ({ page }) => {`);
    switch (step.action) {
      case "goto":
        if (step.target) lines.push(`    await page.goto(${JSON.stringify(step.target)});`);
        break;
      case "click":
        lines.push(`    await page.getByRole("button", { name: ${JSON.stringify(step.target)} }).click();`);
        break;
      case "fill":
        lines.push(`    await page.getByLabel(${JSON.stringify(step.target)}).fill(${JSON.stringify(step.expected ?? "")});`);
        break;
      case "expectText":
        lines.push(`    await expect(page.getByText(${JSON.stringify(step.target)})).toBeVisible();`);
        if (step.expected) lines.push(`    await expect(page.getByText(${JSON.stringify(step.expected)})).toBeVisible();`);
        break;
      case "expectVisible":
        lines.push(`    await expect(page.getByRole("region", { name: ${JSON.stringify(step.target)} })).toBeVisible();`);
        break;
      default:
        lines.push(`    // Unsupported action skipped; no code was generated for it.`);
    }
    lines.push("  });");
  }
  lines.push("});", "");
  return lines.join("\n");
}

/** Validate a parsed LLM plan; unknown actions are dropped, not guessed. */
export function normalizeTestPlan(raw: unknown): QaTestPlan | null {
  if (!isRecord(raw) || typeof raw.goal !== "string" || !Array.isArray(raw.steps)) return null;
  const actions: readonly string[] = ["goto", "click", "fill", "expectText", "expectVisible"];
  const steps: QaTestStep[] = [];
  for (const value of raw.steps) {
    if (!isRecord(value) || typeof value.label !== "string") continue;
    const action = actions.find((candidate) => candidate === value.action);
    if (!action || typeof value.target !== "string") continue;
    steps.push({
      label: value.label.slice(0, 200),
      action: action as QaTestAction,
      target: value.target.slice(0, 1_000),
      ...(typeof value.expected === "string" ? { expected: value.expected.slice(0, 1_000) } : {}),
    });
  }
  if (steps.length === 0) return null;
  return {
    goal: raw.goal.slice(0, 300),
    steps,
    ...(Array.isArray(raw.assumptions)
      ? { assumptions: raw.assumptions.filter((a): a is string => typeof a === "string").slice(0, 20) }
      : {}),
  };
}
