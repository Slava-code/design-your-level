import type { RenameRequest, RenameResponse } from "@/lib/types";
import { route, json, readJson, ApiErr } from "@/lib/server/http";
import { requireTeam, requirePhase } from "@/lib/server/event";
import { parseTeamName } from "@/lib/server/validate";
import { q1 } from "@/lib/server/db";
import { logFeed } from "@/lib/server/feed";
import { teamSummary } from "@/lib/server/views";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = route(async (req: Request) => {
  const { slot, event } = await requireTeam();
  requirePhase(event, ["LOBBY", "DESIGN"], "Renaming");
  const body = await readJson<Partial<RenameRequest>>(req);
  const name = parseTeamName(body.name);
  const prev = await q1("SELECT name FROM teams WHERE slot = $1", [slot]);
  const row = await q1(
    `UPDATE teams SET name = $2 WHERE slot = $1 AND (SELECT phase FROM event_state WHERE id = 1) IN ('LOBBY','DESIGN') RETURNING *`,
    [slot, name],
  );
  if (!row) throw new ApiErr("phase", "Names are locked once voting starts.");
  if (prev?.name !== name) await logFeed("renamed", slot, { from: prev?.name ?? null, to: name });
  return json<RenameResponse>({ team: teamSummary(row) });
});
