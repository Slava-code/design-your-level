import type { AdminTeamDetailResponse } from "@/lib/types";
import { route, json, ApiErr } from "@/lib/server/http";
import { requireAdmin } from "@/lib/server/event";
import { q } from "@/lib/server/db";
import { loadAdminTeam } from "@/lib/server/state";
import { generationAdminView } from "@/lib/server/views";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async (_req: Request, ctx: { params: Promise<{ slot: string }> }) => {
  await requireAdmin();
  const slot = Number((await ctx.params).slot);
  if (!Number.isInteger(slot) || slot < 1) throw new ApiErr("bad_request", "Bad slot.");
  const team = await loadAdminTeam(slot);
  if (!team) throw new ApiErr("not_found", "That team hasn't joined.");
  const gens = await q("SELECT * FROM generations WHERE slot = $1 ORDER BY created_at DESC, id DESC", [slot]);
  return json<AdminTeamDetailResponse>({ team, generations: gens.map((g) => generationAdminView(g, team.submittedGenerationId)) });
});
