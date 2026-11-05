import type { AdminLoginRequest, OkResponse } from "@/lib/types";
import { route, json, readJson, clientIp, ApiErr } from "@/lib/server/http";
import { rateLimitGate } from "@/lib/server/ratelimit";
import { isAdminCode } from "@/lib/server/config";
import { getEvent } from "@/lib/server/event";
import { setAdminCookie } from "@/lib/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = route(async (req: Request) => {
  const body = await readJson<Partial<AdminLoginRequest>>(req);
  if (typeof body.code !== "string" || !body.code.trim() || body.code.length > 300) throw new ApiErr("bad_request", "Type the admin code.");
  const ip = clientIp(req);
  const settle = await rateLimitGate(ip, "admin");
  const ok = isAdminCode(body.code);
  await settle(ok);
  if (!ok) {
    throw new ApiErr("invalid_code", "Wrong admin code.");
  }
  const event = await getEvent();
  await setAdminCookie(Number(event.epoch));
  return json<OkResponse>({ ok: true });
});
