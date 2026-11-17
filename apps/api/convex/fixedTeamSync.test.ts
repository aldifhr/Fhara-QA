/// <reference types="vite/client" />
/**
 * Plan 040 (P1): the fixed-team sync brings existing rows to the role
 * policy without touching user choices. A prompt is replaced only when it
 * is exactly an earlier seed (D10). Each patched row leaves an audit entry.
 *
 * Plan 068: the roster is QA-only. Retired roles (CTO, Frontend, Backend,
 * Designer, …) are disabled and stamped `retiredAt` once by the sync so a
 * stale row can never be routed; their stored prompts are left untouched.
 */
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import { syncedTools } from "./agents";
import { ROLES } from "./lib/roles";
import { AGENT_SEED_PROMPTS, PREVIOUS_SEED_PROMPTS } from "./lib/prompts/agents";

const modules = import.meta.glob("./**/*.ts");
const makeT = () => convexTest(schema, modules);

describe("syncedTools", () => {
  test("always returns null — no tool migrations remain after retired-role removal", () => {
    expect(syncedTools(["read_file", "write_file"], "frontend")).toBeNull();
    expect(syncedTools(["read_file"], "qa")).toBeNull();
    expect(syncedTools(["read_file", "write_file"], "backend")).toBeNull();
    expect(syncedTools(["read_file"], "cto")).toBeNull();
    expect(syncedTools(undefined, "frontend")).toBeNull();
    // Retired role keys are no longer migrated either.
    expect(syncedTools(["read_file"], "researcher")).toBeNull();
  });
});

describe("fixed-team sync: unedited seed prompts and fresh seeds", () => {
  test("replaces an unedited QA seed with the current template and audits the patch", async () => {
    const t = makeT();
    const qaId = await t.run(async (ctx) =>
      await ctx.db.insert("agents", {
        name: "Assistant", role: "qa", status: "idle", isEnabled: true, description: "d",
        capabilities: [...ROLES.qa.capabilities], supportedTools: [...ROLES.qa.defaultTools],
        systemPrompt: PREVIOUS_SEED_PROMPTS.qa![0],
      })
    );

    await t.mutation(internal.agents.syncFixedTeamInternal, {});
    const row = await t.run(async (ctx) => ({
      qa: await ctx.db.get(qaId),
      audit: await ctx.db.query("audit").collect(),
    }));
    expect(row.qa?.systemPrompt).toBe(AGENT_SEED_PROMPTS.qa);
    const synced = row.audit.filter((a) => a.action === "agent.sync" && a.target === "Assistant");
    expect(synced).toHaveLength(1);
    expect((synced[0].details as { changed: string[] }).changed).toContain("systemPrompt");

    // Idempotent: a second sync patches nothing more.
    await t.mutation(internal.agents.syncFixedTeamInternal, {});
    const again = await t.run(async (ctx) => (await ctx.db.query("audit").collect()).filter((a) => a.action === "agent.sync"));
    expect(again).toHaveLength(synced.length);
  });

  test("keeps an edited QA prompt and disables retired-role agents with a stamp", async () => {
    const t = makeT();
    const ids = await t.run(async (ctx) => ({
      reviewer: await ctx.db.insert("agents", {
        name: "Reviewer", role: "reviewer", status: "idle", isEnabled: true, description: "d",
        capabilities: ["code-review"], supportedTools: ["read_file", "write_file", "figma_peek"],
        systemPrompt: "my own review prompt",
      }),
      qa: await ctx.db.insert("agents", {
        name: "Assistant", role: "qa", status: "idle", isEnabled: true, description: "d",
        capabilities: [...ROLES.qa.capabilities], supportedTools: [...ROLES.qa.defaultTools],
        systemPrompt: `${PREVIOUS_SEED_PROMPTS.qa![0]} Also check Safari.`,
      }),
      cto: await ctx.db.insert("agents", {
        name: "CTO", role: "cto", status: "idle", isEnabled: true, description: "d",
        capabilities: ["architecture", "project-coordination"], supportedTools: ["read_file"],
        systemPrompt: PREVIOUS_SEED_PROMPTS.cto![0],
      }),
    }));

    await t.mutation(internal.agents.syncFixedTeamInternal, {});
    const rows = await t.run(async (ctx) => ({
      reviewer: await ctx.db.get(ids.reviewer),
      qa: await ctx.db.get(ids.qa),
      cto: await ctx.db.get(ids.cto),
    }));

    // Plan 068: retired-role rows are disabled and stamped, prompts untouched.
    for (const row of [rows.reviewer, rows.cto]) {
      expect(row?.isEnabled).toBe(false);
      expect(row?.retiredAt).toBeGreaterThan(0);
    }
    expect(rows.reviewer?.systemPrompt).toBe("my own review prompt");
    expect(rows.cto?.systemPrompt).toBe(PREVIOUS_SEED_PROMPTS.cto![0]);
    // An edited QA prompt stays exactly as is.
    expect(rows.qa?.systemPrompt).toBe(`${PREVIOUS_SEED_PROMPTS.qa![0]} Also check Safari.`);
    expect(rows.qa?.supportedTools).toEqual(ROLES.qa.defaultTools);

    // A later sync does not re-stamp a retired row (manual re-enable is respected).
    await t.run(async (ctx) => ctx.db.patch(ids.reviewer, { isEnabled: true }));
    const stamped = (await t.run(async (ctx) => await ctx.db.get(ids.reviewer)))?.retiredAt;
    await t.mutation(internal.agents.syncFixedTeamInternal, {});
    const after = await t.run(async (ctx) => await ctx.db.get(ids.reviewer));
    expect(after?.isEnabled).toBe(true);
    expect(after?.retiredAt).toBe(stamped);
  });

  test("fresh seed rows follow the fixed-team policy; retired roles are not seeded", async () => {
    const t = makeT();
    await t.mutation(internal.agents.syncFixedTeamInternal, {});
    const agents = await t.run(async (ctx) => await ctx.db.query("agents").collect());
    expect(agents).toHaveLength(1);
    const qa = agents[0];
    expect(qa.role).toBe("qa");
    expect(qa.name).toBe("Assistant");
    expect(qa.isEnabled).toBe(true);
    expect(qa.systemPrompt).toBe(AGENT_SEED_PROMPTS.qa);
    expect(qa.supportedTools).toContain("write_file");
    expect(qa.supportedTools).not.toContain("web_reach");
    expect(qa.capabilities).toEqual(ROLES.qa.capabilities);
    for (const role of ["frontend", "backend", "cto", "designer"]) {
      expect(agents.some((agent) => agent.role === role)).toBe(false);
    }
  });
});
