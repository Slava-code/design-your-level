import type { VoteRequest, VoteResponse } from "@/lib/types";
import { route, json, readJson, ApiErr } from "@/lib/server/http";
import { requireTeam, requirePhase } from "@/lib/server/event";
import { parseScores } from "@/lib/server/validate";
import { q1 } from "@/lib/server/db";
import { logFeed } from "@/lib/server/feed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = route(async (req: Request) => {
  const { slot, event } = await requireTeam();
  requirePhase(event, ["VOTING"], "Voting");
  const body = await readJson<Partial<VoteRequest>>(req);
  if (typeof body.target !== "string" || !body.target) throw new ApiErr("bad_request", "target is required.");
  const s = parseScores(body.scores);
  const a = await q1("SELECT target_slot FROM assignments WHERE voter_slot = $1 AND generation_id = $2", [slot, body.target]);
  if (!a) throw new ApiErr("bad_request", "That design isn't one of the ones assigned to you.");
  const row = await q1(
    `INSERT INTO votes (voter_slot, target_slot, level, enemy, ability, puzzle)
     SELECT $1, $2, $3, $4, $5, $6 WHERE (SELECT phase FROM event_state WHERE id = 1 FOR SHARE) = 'VOTING'
     ON CONFLICT (voter_slot, target_slot) DO UPDATE
       SET level = EXCLUDED.level, enemy = EXCLUDED.enemy, ability = EXCLUDED.ability, puzzle = EXCLUDED.puzzle, updated_at = now()
     RETURNING (xmax = 0) AS inserted`,
    [slot, a.target_slot, s.level, s.enemy, s.ability, s.puzzle],
  );
  if (!row) throw new ApiErr("phase", "Voting is closed.");
  if (row.inserted) await logFeed("voted", slot, { target: Number(a.target_slot) });
  const c = await q1(
    `SELECT count(*) AS total, count(v.voter_slot) AS done FROM assignments a
       LEFT JOIN votes v ON v.voter_slot = a.voter_slot AND v.target_slot = a.target_slot WHERE a.voter_slot = $1`,
    [slot],
  );
  return json<VoteResponse>({ ok: true, done: Number(c?.done ?? 0), total: Number(c?.total ?? 0) });
});
