import { describe, expect, it } from "vitest";
import {
  classifyPlaywrightFailure,
  normalizeTestPlan,
  parsePlaywrightReport,
  qaChecksFromPlaywright,
  specSourceFromPlan,
  type PlaywrightResult,
} from "@/utils/playwrightAutomation";
import { healerPrompt, specGenerationPrompt, testPlanPrompt } from "@/prompts/playwright";
import { isCommandAllowed } from "@/utils/commandAllowlist";
import { isVerifyCommand } from "@/utils/rolePolicy";

const report = {
  suites: [
    {
      title: "checkout",
      file: "tests/checkout.spec.ts",
      specs: [
        {
          title: "adds an item",
          file: "tests/checkout.spec.ts",
          line: 12,
          tests: [
            { results: [{ status: "passed", duration: 120 }] },
            {
              results: [
                {
                  status: "failed",
                  error: { message: "locator.click: waiting for locator('button[name=Pay]')" },
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

describe("parsePlaywrightReport", () => {
  it("flattens suites, specs and tests with file and line", () => {
    const results = parsePlaywrightReport(report);
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      title: "checkout › adds an item",
      file: "tests/checkout.spec.ts",
      line: 12,
      status: "passed",
      durationMs: 120,
    });
    expect(results[1].status).toBe("failed");
    expect(results[1].error).toContain("locator.click");
  });

  it("caps errors and rejects malformed reports without throwing", () => {
    const long = "x".repeat(9_000);
    const parsed = parsePlaywrightReport({
      suites: [{ specs: [{ tests: [{ results: [{ status: "failed", error: { message: long } }] }] }] }],
    });
    expect(parsed[0].error?.length).toBeLessThan(4_100);
    expect(parsePlaywrightReport(null)).toEqual([]);
    expect(parsePlaywrightReport({ suites: "not-an-array" })).toEqual([]);
  });

  it("treats a spec with no results as skipped", () => {
    expect(parsePlaywrightReport({ suites: [{ specs: [{ tests: [{}] }] }] })[0].status).toBe("skipped");
  });
});

describe("classifyPlaywrightFailure", () => {
  const failed = (error: string): PlaywrightResult => ({ title: "t", status: "failed", error });
  it("classifies locator-shaped timeouts as locator", () => {
    expect(classifyPlaywrightFailure(failed("Timed out 5000ms waiting for locator('getByRole')"))).toBe("locator");
    expect(classifyPlaywrightFailure(failed("strict mode violation: getByText resolved to 2 elements"))).toBe("locator");
  });
  it("classifies assertions, environment and unknown", () => {
    expect(classifyPlaywrightFailure(failed("expect(received).toBe(expected)"))).toBe("assertion");
    expect(classifyPlaywrightFailure(failed("browserType.launch: Executable doesn't exist"))).toBe("environment");
    expect(classifyPlaywrightFailure(failed("something unexpected"))).toBe("unknown");
  });
  it("does not classify passing or skipped results", () => {
    expect(classifyPlaywrightFailure({ title: "t", status: "passed" })).toBe("unknown");
  });
});

describe("qaChecksFromPlaywright", () => {
  it("maps results to QA checks with evidence and file paths", () => {
    const [passed, failedCheck] = qaChecksFromPlaywright(parsePlaywrightReport(report));
    expect(passed.status).toBe("passed");
    expect(failedCheck.status).toBe("failed");
    expect(failedCheck.evidence).toBe("failure kind: locator");
    expect(failedCheck.filePath).toBe("tests/checkout.spec.ts");
    expect(failedCheck.steps).toEqual(["npx playwright test --reporter=json"]);
  });
});

describe("normalizeTestPlan and specSourceFromPlan", () => {
  it("drops unknown actions and keeps only validated steps", () => {
    const plan = normalizeTestPlan({
      goal: "checkout",
      steps: [
        { label: "open", action: "goto", target: "http://localhost:3000" },
        { label: "hack", action: "runCommand", target: "rm -rf /" },
      ],
    });
    expect(plan?.steps).toHaveLength(1);
    expect(plan?.steps[0].action).toBe("goto");
    expect(normalizeTestPlan({ goal: "x", steps: [] })).toBeNull();
  });

  it("JSON-encodes user text so it cannot inject code", () => {
    const source = specSourceFromPlan({
      goal: 'login "; process.exit(1); //',
      steps: [{ label: 'say "hi"', action: "expectText", target: 'He said "hi"' }],
    });
    expect(source).toContain('\\"; process.exit(1)');
    expect(source).not.toContain('\nprocess.exit(1)');
    expect(source).toContain('import { test, expect } from "@playwright/test";');
  });
});

describe("command gate for Playwright", () => {
  const argv = ["playwright", "test", "--reporter=json"];
  it("allows only the exact allowlisted argv", () => {
    expect(isCommandAllowed("npx", argv)).toBe(true);
    expect(isCommandAllowed("npx", [...argv, "--watch"])).toBe(false);
    expect(isCommandAllowed("npx", ["playwright", "test"])).toBe(false);
  });
  it("allows the same exact argv under the verify-only role gate", () => {
    expect(isVerifyCommand("npx", argv)).toBe(true);
    expect(isVerifyCommand("npx", [...argv, "--watch"])).toBe(false);
  });
});

describe("prompts", () => {
  it("asks for strict JSON and the five allowed actions", () => {
    const prompt = testPlanPrompt({ request: "verify checkout" });
    expect(prompt).toContain("STRICT JSON");
    for (const action of ["goto", "click", "fill", "expectText", "expectVisible"]) {
      expect(prompt).toContain(action);
    }
  });
  it("forbids weakening assertions when healing", () => {
    expect(healerPrompt({ specPath: "tests/a.spec.ts", failure: "boom", currentSpec: "" })).toContain(
      "never change the assertion to make it pass"
    );
    expect(specGenerationPrompt({ plan: "{}", filePath: "tests/a.spec.ts" })).toContain("tests/a.spec.ts");
  });
});
