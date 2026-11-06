import type { RenameRequest, RenameResponse } from "@/lib/types";
import { route, json, readJson } from "@/lib/server/http";
import { requireTeam } from "@/lib/server/event";
import { parseTeamName } from "@/lib/server/validate";
import { q, q1 } from "@/lib/server/db";
import { logFeed } from "@/lib/server/feed";
import { teamSummary } from "@/lib/server/views";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Teams can rename in any phase. Voting is anonymous, so a rename never leaks who made a design.
export const POST = route(async (req: Request) => {
  const { slot } = await requireTeam();
  const body = await readJson<Partial<RenameRequest>>(req);
  const name = parseTeamName(body.name);
  const prev = await q1("SELECT name FROM teams WHERE slot = $1", [slot]);
  const row = await q1(`UPDATE teams SET name = $2 WHERE slot = $1 RETURNING *`, [slot, name]);
  // The podium ranking is a snapshot taken when the reveal starts; keep its name in step too.
  await q(
    `UPDATE event_state SET ranking = (
        SELECT jsonb_agg(CASE WHEN (e->>'slot')::int = $1 THEN jsonb_set(e, '{name}', to_jsonb($2::text)) ELSE e END ORDER BY ord)
          FROM jsonb_array_elements(ranking) WITH ORDINALITY AS t(e, ord))
      WHERE id = 1 AND jsonb_typeof(ranking) = 'array' AND jsonb_array_length(ranking) > 0`,
    [slot, name],
  );
  if (prev?.name !== name) await logFeed("renamed", slot, { from: prev?.name ?? null, to: name });
  return json<RenameResponse>({ team: teamSummary(row!) });
});
