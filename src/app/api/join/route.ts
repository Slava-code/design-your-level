import type { JoinRequest, JoinResponse } from "@/lib/types";
import { route, json, readJson, clientIp, ApiErr } from "@/lib/server/http";
import { rateLimitGate } from "@/lib/server/ratelimit";
import { slotForCode, teamBudgetUsd } from "@/lib/server/config";
import { getEvent } from "@/lib/server/event";
import { q1 } from "@/lib/server/db";
import { setTeamCookie } from "@/lib/server/session";
import { logFeed } from "@/lib/server/feed";
import { teamSummary } from "@/lib/server/views";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = route(async (req: Request) => {
  const body = await readJson<Partial<JoinRequest>>(req);
  if (typeof body.code !== "string" || !body.code.trim() || body.code.length > 200) {
    throw new ApiErr("bad_request", "Type your team code.");
  }
  const ip = clientIp(req);
  const settle = await rateLimitGate(ip, "team");
  const slot = slotForCode(body.code);
  await settle(!!slot); // throws rate_limited for a wrong code over the limit
  if (!slot) {
    throw new ApiErr("invalid_code", "That code doesn't match any team. Check the card and try again.");
  }
  const event = await getEvent();
  const row = await q1(
    `INSERT INTO teams (slot, name, budget_usd) VALUES ($1, $2, $3)
     ON CONFLICT (slot) DO UPDATE SET last_seen_at = now()
     RETURNING *, (xmax = 0) AS inserted`,
    [slot, `Team ${slot}`, teamBudgetUsd()],
  );
  await setTeamCookie(slot, Number(event.epoch));
  await logFeed("joined", slot, row!.inserted ? {} : { rejoin: true });
  return json<JoinResponse>({ team: teamSummary(row!), firstJoin: !!row!.inserted });
});
