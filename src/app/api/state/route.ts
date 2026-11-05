// GET /api/state?view=team|admin|screen[&since=<feedId>]: role-aware snapshot, polled every 2 s.
import { after, type NextRequest } from "next/server";
import type { StateResponse } from "@/lib/types";
import { route, json } from "@/lib/server/http";
import { readAdminCookie, readTeamCookie, clearTeamCookie } from "@/lib/server/session";
import { getEvent } from "@/lib/server/event";
import { anonState, buildAdminState, buildTeamState, loadTeamBundle, touchLastSeen } from "@/lib/server/state";
import { sweepStuck } from "@/lib/server/budget";
import { STUCK_MS } from "@/lib/server/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const sweepLater = () =>
  after(async () => {
    try {
      await sweepStuck(STUCK_MS);
    } catch (e) {
      console.error("[sweep] failed:", e instanceof Error ? e.message : e);
    }
  });

export const GET = route(async (req: NextRequest) => {
  const sp = req.nextUrl.searchParams;
  const viewParam = sp.get("view");
  const sinceRaw = sp.get("since");
  const since = sinceRaw != null && /^\d+$/.test(sinceRaw) ? Number(sinceRaw) : null;
  const [teamC, adminC] = await Promise.all([readTeamCookie(), readAdminCookie()]);
  const view = viewParam === "admin" || viewParam === "screen" || viewParam === "team" ? viewParam : teamC.session ? "team" : adminC.session ? "admin" : "team";
  sweepLater();

  if (view === "admin" || view === "screen") {
    if (adminC.session) {
      const s = await buildAdminState(view, since);
      if (s.epoch === adminC.session.epoch) return json<StateResponse>(s);
    }
    return json<StateResponse>(anonState(await getEvent(), adminC.present));
  }

  if (teamC.session) {
    const bundle = await loadTeamBundle(teamC.session.slot);
    if (bundle.team && Number(bundle.event.epoch) === teamC.session.epoch) {
      const slot = teamC.session.slot;
      after(() => touchLastSeen(slot).catch(() => {}));
      return json<StateResponse>(buildTeamState({ ...bundle, team: bundle.team }));
    }
    await clearTeamCookie();
    return json<StateResponse>(anonState(bundle.event, true));
  }
  return json<StateResponse>(anonState(await getEvent(), teamC.present));
});
