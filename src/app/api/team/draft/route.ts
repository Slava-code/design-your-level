import { DESIGN_FIELD_MAX, MAX_REFS, type DesignFields, type DraftResponse, type DraftSaveResponse } from "@/lib/types";
import { route, json, readJson } from "@/lib/server/http";
import { requireTeam } from "@/lib/server/event";
import { parseRefs } from "@/lib/server/validate";
import { refsPrefix } from "@/lib/server/blob";
import { q1, isoOrNull } from "@/lib/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/** The team's autosaved design form (shared by every device on the team). */
export const GET = route(async () => {
  const { slot } = await requireTeam();
  const row = await q1("SELECT draft, draft_updated_at FROM teams WHERE slot = $1", [slot]);
  return json<DraftResponse>({ draft: (row?.draft as DraftResponse["draft"]) ?? null, updatedAt: isoOrNull(row?.draft_updated_at) });
});

/** Saves the whole form (it is small, so a full copy each time is simpler than deltas). */
export const POST = route(async (req: Request) => {
  const { slot, event } = await requireTeam();
  const body = await readJson<{ fields?: Record<string, unknown>; refs?: unknown }>(req);
  const src = body.fields && typeof body.fields === "object" ? body.fields : {};
  const fields = {} as DesignFields;
  for (const k of Object.keys(DESIGN_FIELD_MAX) as (keyof DesignFields)[]) {
    // Kept as typed (no trim, so trailing spaces mid-typing survive a restore); control characters
    // removed and capped at the field's limit.
    const v = typeof src[k] === "string" ? (src[k] as string) : "";
    fields[k] = v.replace(CONTROL, "").slice(0, DESIGN_FIELD_MAX[k]);
  }
  // Only reference images this team uploaded through the app are kept; anything else is dropped.
  const prefix = refsPrefix(Number(event.epoch), slot);
  const refs = (Array.isArray(body.refs) ? body.refs : []).slice(0, MAX_REFS).flatMap((r) => {
    try {
      const [ok] = parseRefs([r], prefix);
      const o = r as { id?: unknown; name?: unknown };
      return [{ ...ok, id: typeof o.id === "string" ? o.id.slice(0, 64) : ok.url.slice(-24), name: typeof o.name === "string" ? o.name.slice(0, 120) : undefined }];
    } catch {
      return [];
    }
  });
  const row = await q1(
    "UPDATE teams SET draft = $2::jsonb, draft_updated_at = now() WHERE slot = $1 RETURNING draft_updated_at",
    [slot, JSON.stringify({ fields, refs })],
  );
  return json<DraftSaveResponse>({ updatedAt: isoOrNull(row?.draft_updated_at) });
});
