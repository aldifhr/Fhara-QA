import { describe, expect, it } from "vitest";
import { ROLE_KEYS, ROLES, RETIRED_ROLE_KEYS, LEGACY_ROLE_SUCCESSORS } from "./lib/roles";
import { AGENT_TOOL_NAMES } from "./lib/toolNames";

describe("role tool defaults (plan 036)", () => {
  it("has a single QA role that may write only test paths and never uses the web tool", () => {
    expect(ROLE_KEYS).toEqual(["qa"]);
    expect(Object.keys(ROLES)).toEqual(["qa"]);
    expect(ROLES.qa.label).toBe("Assistant");
    expect(ROLES.qa.defaultTools).not.toContain("web_reach");
    expect(ROLES.qa.defaultTools).toContain("write_file");
    expect(ROLES.qa.permissions.write).toEqual([
      "tests/**",
      "e2e/**",
      "**/*.test.*",
      "**/*.spec.*",
      "**/__tests__/**",
      "playwright.config.*",
    ]);
  });

  it("resolves retired role aliases to QA and disables them on sync", () => {
    for (const role of RETIRED_ROLE_KEYS) expect(LEGACY_ROLE_SUCCESSORS[role]).toBe("qa");
    for (const role of ["front-end", "back-end", "ui-ux", "support", "reviewer", "researcher"]) {
      expect(LEGACY_ROLE_SUCCESSORS[role]).toBe("qa");
    }
  });

  it("offers only known tool names in the agent editor", () => {
    expect(AGENT_TOOL_NAMES).toContain("web_reach");
    for (const name of AGENT_TOOL_NAMES) {
      expect(["read_file", "write_file", "run_command", "web_reach"]).toContain(name);
    }
  });
});
