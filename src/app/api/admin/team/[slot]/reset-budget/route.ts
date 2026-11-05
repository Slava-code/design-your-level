import type { ResetBudgetResponse } from "@/lib/types";
import { route, json, ApiErr } from "@/lib/server/http";
import { requireAdmin } from "@/lib/server/event";
import { resetTeamBudget } from "@/lib/server/budget";
import { logFeed } from "@/lib/server/feed";
import { teamSummary } from "@/lib/server/views";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = route(async (_req: Request, ctx: { params: Promise<{ slot: string }> }) => {
  await requireAdmin();
  const slot = Number((await ctx.params).slot);
  if (!Number.isInteger(slot) || slot < 1) throw new ApiErr("bad_request", "Bad slot.");
  const row = await resetTeamBudget(slot);
  if (!row) throw new ApiErr("not_found", "That team hasn't joined.");
  await logFeed("budget_reset", slot, {});
  return json<ResetBudgetResponse>({ team: teamSummary(row) });
});
