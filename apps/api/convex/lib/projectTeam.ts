import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

/**
 * QA fork (plan 068): there is one global agent, so a project has no roster.
 * `projects.agentIds` is left in the schema for old rows but is not written or
 * read to decide the team. Every enabled agent is available to every project.
 */
export function effectiveTeamIds(
  _projectAgentIds: readonly Id<"agents">[] | undefined,
  allAgents: readonly Pick<Doc<"agents">, "_id" | "isEnabled">[],
): Id<"agents">[] {
  return allAgents.filter((agent) => agent.isEnabled !== false).map((agent) => agent._id);
}

/** Every enabled agent, regardless of any legacy project membership field. */
export async function projectTeamIds(
  ctx: Pick<QueryCtx, "db">,
  _project: Pick<Doc<"projects">, "agentIds"> | null | undefined,
): Promise<Id<"agents">[]> {
  return effectiveTeamIds(undefined, await ctx.db.query("agents").take(500));
}
