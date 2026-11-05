// Dev/test only: set a team's budget. 404 in production (unless ALLOW_DEV_ROUTES=1 locally, for e2e).
import type { DevTeamBudgetRequest } from "@/lib/types";
import { route, json, readJson, ApiErr } from "@/lib/server/http";
import { requireAdmin } from "@/lib/server/event";
import { devRoutesEnabled } from "@/lib/server/config";
import { q1 } from "@/lib/server/db";
import { logFeed } from "@/lib/server/feed";
import { teamSummary } from "@/lib/server/views";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = route(async (req: Request) => {
  if (!devRoutesEnabled()) throw new ApiErr("not_found", "Not found.");
  await requireAdmin();
  const body = await readJson<Partial<DevTeamBudgetRequest>>(req);
  const slot = Number(body.slot);
  const budget = Number(body.budgetUsd);
  if (!Number.isInteger(slot) || !Number.isFinite(budget) || budget < 0 || budget > 100) throw new ApiErr("bad_request", "slot and budgetUsd (0-100) required.");
  const row = await q1("UPDATE teams SET budget_usd = $2 WHERE slot = $1 RETURNING *", [slot, budget]);
  if (!row) throw new ApiErr("not_found", "That team hasn't joined.");
  await logFeed("budget_set", slot, { budgetUsd: budget });
  return json({ team: teamSummary(row) });
});
