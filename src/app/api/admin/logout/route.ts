import type { OkResponse } from "@/lib/types";
import { route, json } from "@/lib/server/http";
import { clearAdminCookie } from "@/lib/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = route(async () => {
  await clearAdminCookie();
  return json<OkResponse>({ ok: true });
});
