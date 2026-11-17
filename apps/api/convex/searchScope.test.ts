/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

describe("search.global scoping (plan 068: one global agent team)", () => {
  test("agents are global; projects and tasks stay scoped to what the viewer can see", async () => {
    const t = convexTest(schema, modules);
    const { visibleAgent, hiddenAgent, orphan, openProjectId } = await t.run(async (ctx) => {
      const visibleAgent = await ctx.db.insert("agents", { name: "Alpha dev", role: "developer", status: "idle" });
      const hiddenAgent = await ctx.db.insert("agents", { name: "Alpha secret", role: "developer", status: "idle" });
      const orphan = await ctx.db.insert("agents", { name: "Alpha orphan", role: "developer", status: "idle" });
      const openProjectId = await ctx.db.insert("projects", { name: "Alpha open", workspacePath: "/tmp/open", agentIds: [visibleAgent] });
      const privateProjectId = await ctx.db.insert("projects", {
        name: "Alpha private",
        workspacePath: "/tmp/private",
        ownerId: "other-user",
        agentIds: [hiddenAgent],
      });
      await ctx.db.insert("tasks", { projectId: openProjectId, title: "Alpha visible task", command: "c", status: "queued" });
      await ctx.db.insert("tasks", { projectId: privateProjectId, title: "Alpha hidden task", command: "c", status: "queued" });
      return { visibleAgent, hiddenAgent, orphan, openProjectId };
    });
    const res = await t.query(api.search.global, { q: "alpha" });
    // Agents are a global registry: every agent is searchable by every viewer.
    expect(res.agents.map((a) => a._id)).toEqual([visibleAgent, hiddenAgent, orphan]);
    expect(res.agents[0].projectId).toBe(openProjectId);
    // Visibility still holds for projects and their tasks (core H5).
    expect(res.projects.map((p) => p._id)).toEqual([openProjectId]);
    expect(res.tasks.map((task) => task.title)).toEqual(["Alpha visible task"]);
    expect(JSON.stringify(res)).not.toContain("Alpha private");
    expect(JSON.stringify(res)).not.toContain("Alpha hidden task");
  });

  test("an owned project is visible only to its owner; agents are visible to all", async () => {
    const t = convexTest(schema, modules);
    const { agentId, mineId } = await t.run(async (ctx) => {
      const agentId = await ctx.db.insert("agents", { name: "Beta", role: "qa", status: "idle" });
      const mineId = await ctx.db.insert("projects", { name: "Beta mine", workspacePath: "/tmp/m", ownerId: "user-1", agentIds: [agentId] });
      await ctx.db.insert("tasks", { projectId: mineId, title: "Beta task", command: "c", status: "queued" });
      return { agentId, mineId };
    });
    const anon = await t.query(api.search.global, { q: "beta" });
    expect(anon.agents.map((a) => a._id)).toEqual([agentId]);
    expect(anon.agents[0].projectId).toBeNull();
    expect(anon.projects).toEqual([]);
    expect(anon.tasks).toEqual([]);

    const owner = await t.withIdentity({ subject: "user-1" }).query(api.search.global, { q: "beta" });
    expect(owner.agents.map((a) => a._id)).toEqual([agentId]);
    expect(owner.projects.map((p) => p._id)).toEqual([mineId]);
    expect(owner.tasks.map((task) => task.title)).toEqual(["Beta task"]);
    expect(owner.agents[0].projectId).toBe(mineId);
  });
});
