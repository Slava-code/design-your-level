// GET /api/admin/games/[id]: a past game from its snapshot. ?download=1 returns the full raw snapshot as a file.
import type { GameDetailResponse } from "@/lib/types";
import { route, json, ApiErr } from "@/lib/server/http";
import { requireAdmin } from "@/lib/server/event";
import { gameDetail, gameSnapshot } from "@/lib/server/games";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireAdmin();
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id) || id < 1) throw new ApiErr("bad_request", "Bad game id.");
  const found = await gameSnapshot(id);
  if (!found) throw new ApiErr("not_found", "No saved snapshot for that game (it may be the live one).");
  if (new URL(req.url).searchParams.get("download") === "1") {
    const body = JSON.stringify({ game: id, startedAt: found.row.started_at, endedAt: found.row.ended_at, ...found.snap }, null, 2);
    return new Response(body, {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="design-your-level-game-${id}.json"`,
        "cache-control": "no-store",
      },
    });
  }
  return json<GameDetailResponse>(gameDetail(found.row, found.snap));
});
