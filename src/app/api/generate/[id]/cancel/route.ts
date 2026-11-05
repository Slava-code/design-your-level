// POST /api/generate/[id]/cancel: abandon a follow-up round that is waiting for answers
// (frees the team to start a new generation). Nothing is held in reserve at that point.
import type { CancelResponse } from "@/lib/types";
import { route, json, ApiErr } from "@/lib/server/http";
import { requireTeam } from "@/lib/server/event";
import { q1 } from "@/lib/server/db";
import { finish } from "@/lib/server/budget";
import { logFeed } from "@/lib/server/feed";
import { generationView } from "@/lib/server/views";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { slot } = await requireTeam();
  const { id } = await ctx.params;
  const gen = await q1("SELECT id FROM generations WHERE id = $1 AND slot = $2", [id, slot]);
  if (!gen) throw new ApiErr("not_found", "Generation not found.");
  const row = await finish(id, ["questions"], "error", { error: "Cancelled.", errorDetail: "cancelled by team" });
  if (!row) throw new ApiErr("conflict", "Only a generation waiting for answers can be cancelled.");
  await logFeed("cancelled", slot, { generationId: id });
  return json<CancelResponse>({ generation: generationView(row, null) });
});
