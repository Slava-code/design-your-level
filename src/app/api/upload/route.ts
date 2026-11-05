// Vercel Blob client-upload token route for reference images. The browser calls
//   upload(`${state.uploadPrefix}${name}`, file, { access: "public", handleUploadUrl: "/api/upload" })
// We don't use onUploadCompleted (it doesn't fire on localhost); the client sends the resulting URLs
// with POST /api/generate, which validates host and prefix.
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { MAX_UPLOAD_BYTES, UPLOAD_CONTENT_TYPES } from "@/lib/types";
import { route, json, readJson, ApiErr } from "@/lib/server/http";
import { requireTeam, requirePhase } from "@/lib/server/event";
import { refsPrefix } from "@/lib/server/blob";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = route(async (req: Request) => {
  const body = await readJson<HandleUploadBody>(req);
  let prefix: string | null = null;
  let slot = 0;
  let epoch = 0;
  if (body.type === "blob.generate-client-token") {
    const s = await requireTeam();
    requirePhase(s.event, ["LOBBY", "DESIGN"], "Uploading");
    slot = s.slot;
    epoch = Number(s.event.epoch);
    prefix = refsPrefix(epoch, slot);
  }
  let result;
  try {
    result = await handleUpload({
    body,
    request: req,
    onBeforeGenerateToken: async (pathname) => {
      if (!prefix || !pathname.startsWith(prefix) || pathname.includes("..") || pathname.length > 300) {
        throw new ApiErr("bad_request", "Upload path not allowed.");
      }
      return {
        allowedContentTypes: UPLOAD_CONTENT_TYPES,
        maximumSizeInBytes: MAX_UPLOAD_BYTES,
        addRandomSuffix: true,
        tokenPayload: JSON.stringify({ slot, epoch }),
      };
    },
    });
  } catch (e) {
    if (e instanceof ApiErr) throw e;
    throw new ApiErr("bad_request", e instanceof Error ? e.message : "Upload request rejected.");
  }
  return json(result);
});
