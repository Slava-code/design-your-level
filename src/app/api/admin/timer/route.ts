import type { TimerRequest, TimerResponse } from "@/lib/types";
import { route, json, readJson } from "@/lib/server/http";
import { requireAdmin } from "@/lib/server/event";
import { adjustTimer } from "@/lib/server/admin";
import { isoOrNull } from "@/lib/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = route(async (req: Request) => {
  await requireAdmin();
  const body = await readJson<Partial<TimerRequest>>(req);
  const event = await adjustTimer(body.addSec, body.setSec);
  return json<TimerResponse>({ phaseEndsAt: isoOrNull(event.phase_ends_at) });
});
