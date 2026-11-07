import { SCORE_KEYS, type OkResponse } from "@/lib/types";
import { route, json, readJson, ApiErr } from "@/lib/server/http";
import { requireTeam, requirePhase } from "@/lib/server/event";
import { q1 } from "@/lib/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Saves a partly-scored design (any score may be null). A full vote still goes through POST /api/vote. */
export const POST = route(async (req: Request) => {
  const { slot, event } = await requireTeam();
  requirePhase(event, ["VOTING"], "Voting");
  const body = await readJson<{ target?: unknown; scores?: Record<string, unknown> }>(req);
  if (typeof body.target !== "string" || !body.target) throw new ApiErr("bad_request", "target is required.");
  const src = body.scores && typeof body.scores === "object" ? body.scores : {};
  const scores: Record<string, number | null> = {};
  for (const k of SCORE_KEYS) {
    const v = src[k];
    scores[k] = Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 5 ? (v as number) : null;
  }
  const a = await q1("SELECT 1 FROM assignments WHERE voter_slot = $1 AND generation_id = $2", [slot, body.target]);
  if (!a) throw new ApiErr("bad_request", "That design isn't one of the ones assigned to you.");
  await q1(
    "UPDATE teams SET vote_draft = COALESCE(vote_draft, '{}'::jsonb) || jsonb_build_object($2::text, $3::jsonb) WHERE slot = $1",
    [slot, body.target, JSON.stringify(scores)],
  );
  return json<OkResponse>({ ok: true });
});
