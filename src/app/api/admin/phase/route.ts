import type { PhaseRequest, PhaseResponse, Phase } from "@/lib/types";
import { route, json, readJson } from "@/lib/server/http";
import { requireAdmin } from "@/lib/server/event";
import { changePhase } from "@/lib/server/admin";
import { isoOrNull } from "@/lib/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = route(async (req: Request) => {
  await requireAdmin();
  const body = await readJson<Partial<PhaseRequest>>(req);
  const { event, warning } = await changePhase(body.phase as Phase, body.durationSec);
  return json<PhaseResponse>({ phase: event.phase, phaseEndsAt: isoOrNull(event.phase_ends_at), ...(warning ? { warning } : {}) });
});
