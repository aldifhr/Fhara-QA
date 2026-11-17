/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { effectiveTeamIds } from "./projectTeam";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");

async function seedAgents() {
  const t = convexTest(schema, modules);
  return t.run(async (ctx) => {
    const cto = await ctx.db.insert("agents", { name: "CTO", role: "cto", status: "idle", isEnabled: true });
    const qa = await ctx.db.insert("agents", { name: "QA", role: "qa", status: "idle", isEnabled: true });
    const disabled = await ctx.db.insert("agents", { name: "Off", role: "reviewer", status: "idle", isEnabled: false });
    return { cto, qa, disabled, all: await ctx.db.query("agents").collect() };
  });
}

describe("effectiveTeamIds (one global agent team)", () => {
  test("the roster argument is ignored: every enabled agent is available to any project", async () => {
    const { cto, qa, all } = await seedAgents();
    expect(effectiveTeamIds(undefined, all)).toEqual([cto, qa]);
    expect(effectiveTeamIds([], all)).toEqual([cto, qa]);
    expect(effectiveTeamIds([qa], all)).toEqual([cto, qa]);
  });

  test("disabled agents are never in the team", async () => {
    const { cto, qa, disabled, all } = await seedAgents();
    expect(all).toHaveLength(3);
    expect(effectiveTeamIds([disabled], all)).toEqual([cto, qa]);
    expect(effectiveTeamIds(undefined, all)).not.toContain(disabled);
  });
});
