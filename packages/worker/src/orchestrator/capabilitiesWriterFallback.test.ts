import { describe, expect, it } from "vitest";
import { routeCapability } from "./capabilities";

describe("routeCapability writer fallback (plan 040: opt-in only)", () => {
  const qa = { _id: "qa", name: "QA", role: "qa", capabilities: ["browser-testing"], supportedTools: ["read_file", "run_command"], priority: 9 };
  const backend = { _id: "be", name: "Backend", role: "backend", capabilities: ["backend-api"], supportedTools: ["read_file", "write_file", "run_command"], priority: 3 };
  it("unheld frontend work routes to nobody by default (BLOCKED, no guess)", () => {
    expect(routeCapability("frontend-development", [qa, backend])).toBeNull();
  });
  it("with the opt-in fallback, it goes to an agent that may write (QA writes test paths)", () => {
    expect(routeCapability("frontend-development", [qa, backend], { allowFallback: true })?._id).toBe("qa");
  });
  it("never to an agent that may not write, even with the fallback", () => {
    const noWrite = { ...qa, _id: "nowrite", role: "custom-nowrite", supportedTools: ["read_file"] };
    expect(routeCapability("frontend-development", [noWrite], { allowFallback: true })).toBeNull();
  });
});
