import type { RevealRequest, RevealResponse } from "@/lib/types";
import { route, json, readJson } from "@/lib/server/http";
import { requireAdmin } from "@/lib/server/event";
import { moveReveal } from "@/lib/server/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = route(async (req: Request) => {
  await requireAdmin();
  const body = await readJson<Partial<RevealRequest>>(req);
  return json<RevealResponse>({ reveal: await moveReveal(body.action, body.fromStep) });
});
