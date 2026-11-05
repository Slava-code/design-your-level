import type { SubmitRequest, SubmitResponse } from "@/lib/types";
import { route, json, readJson, ApiErr } from "@/lib/server/http";
import { requireTeam, requirePhase } from "@/lib/server/event";
import { q1 } from "@/lib/server/db";
import { logFeed } from "@/lib/server/feed";
import { teamSummary } from "@/lib/server/views";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = route(async (req: Request) => {
  const { slot, event } = await requireTeam();
  requirePhase(event, ["DESIGN"], "Submitting");
  const body = await readJson<Partial<SubmitRequest>>(req);
  if (typeof body.generationId !== "string" || !body.generationId) throw new ApiErr("bad_request", "generationId is required.");
  const gen = await q1("SELECT id, status FROM generations WHERE id = $1 AND slot = $2", [body.generationId, slot]);
  if (!gen) throw new ApiErr("not_found", "Generation not found.");
  if (gen.status !== "done") throw new ApiErr("conflict", "Only a finished storyboard can be submitted.");
  const prev = await q1("SELECT submitted_generation_id FROM teams WHERE slot = $1", [slot]);
  const row = await q1(
    `UPDATE teams SET submitted_generation_id = $2, submitted_at = now()
      WHERE slot = $1 AND (SELECT phase FROM event_state WHERE id = 1 FOR SHARE) = 'DESIGN' RETURNING *`,
    [slot, gen.id],
  );
  if (!row) throw new ApiErr("phase", "Submissions are closed.");
  const prevId = prev?.submitted_generation_id ?? null;
  if (prevId !== gen.id) await logFeed("submitted", slot, { generationId: gen.id, resubmit: prevId != null });
  return json<SubmitResponse>({ team: teamSummary(row) });
});
