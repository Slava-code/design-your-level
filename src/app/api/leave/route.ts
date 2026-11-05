import type { OkResponse } from "@/lib/types";
import { route, json } from "@/lib/server/http";
import { clearTeamCookie } from "@/lib/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Clears this browser's team cookie (the team itself is unaffected). */
export const POST = route(async () => {
  await clearTeamCookie();
  return json<OkResponse>({ ok: true });
});
