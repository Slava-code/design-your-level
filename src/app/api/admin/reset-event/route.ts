import type { ResetEventRequest, ResetEventResponse } from "@/lib/types";
import { route, json, readJson, ApiErr } from "@/lib/server/http";
import { requireAdmin } from "@/lib/server/event";
import { resetEvent } from "@/lib/server/admin";
import { setAdminCookie } from "@/lib/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const POST = route(async (req: Request) => {
  await requireAdmin();
  const body = await readJson<Partial<ResetEventRequest>>(req);
  if (body.confirm !== "RESET") throw new ApiErr("bad_request", 'Type RESET to confirm.');
  const r = await resetEvent();
  // Keep the admin who pressed the button logged in under the new epoch.
  await setAdminCookie(r.epoch);
  return json<ResetEventResponse>({ ok: true, epoch: r.epoch, blobsDeleted: r.blobsDeleted });
});
