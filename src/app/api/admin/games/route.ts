import type { GamesResponse } from "@/lib/types";
import { route, json } from "@/lib/server/http";
import { requireAdmin } from "@/lib/server/event";
import { listGames } from "@/lib/server/games";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async () => {
  await requireAdmin();
  return json<GamesResponse>({ games: await listGames() });
});
