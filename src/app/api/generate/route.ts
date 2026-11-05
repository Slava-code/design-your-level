// POST /api/generate: start a generation. Returns immediately; the AI work runs in after() and the
// client polls /api/state. The team's first generation always has a follow-up round.
import { after } from "next/server";
import type { GenerateRequest, GenerateResponse } from "@/lib/types";
import { moderate, estimateFollowupUsd, estimateGenerationUsd, MODELS, type DesignInput } from "@/lib/ai";
import { route, json, readJson, ApiErr } from "@/lib/server/http";
import { requireTeam, requirePhase } from "@/lib/server/event";
import { parseDesign, parseRefs } from "@/lib/server/validate";
import { q1, isUniqueViolation } from "@/lib/server/db";
import { refsPrefix } from "@/lib/server/blob";
import { insertFlaggedGeneration, reserveAndInsertGeneration } from "@/lib/server/budget";
import { logFeed } from "@/lib/server/feed";
import { generationView } from "@/lib/server/views";
import { runFollowups, runGeneration, withDeadline, MSG } from "@/lib/server/pipeline";
import { newId } from "@/lib/server/ids";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The image call can take a minute or two; after() work is bounded by this route's maxDuration.
export const maxDuration = 300;

const BUSY = "You already have a generation in progress. Wait for it to finish (or answer its questions) first.";

export const POST = route(async (req: Request) => {
  const startedAt = Date.now();
  const { slot, event } = await requireTeam();
  requirePhase(event, ["DESIGN"], "Generating");
  const epoch = Number(event.epoch);
  const body = await readJson<Partial<GenerateRequest>>(req);
  const design = parseDesign(body.design);
  const references = parseRefs(body.references, refsPrefix(epoch, slot));

  const stats = await q1(
    `SELECT count(*) FILTER (WHERE status IN ('asking','questions','generating')) AS inflight,
            count(*) FILTER (WHERE questions IS NOT NULL) AS asked
       FROM generations WHERE slot = $1`,
    [slot],
  );
  if (Number(stats?.inflight ?? 0) > 0) throw new ApiErr("busy", BUSY);
  const askQuestions = body.askQuestions === true || Number(stats?.asked ?? 0) === 0;

  const id = newId();
  // Moderation pre-check (free). Fail open if the endpoint itself errors: the image model has its own filter.
  try {
    const m = await moderate(Object.values(design).filter(Boolean).join("\n"));
    if (m.flagged) {
      const row = await insertFlaggedGeneration({ id, slot, inputs: design, refs: references, message: MSG.flagged, detail: m.categories.join(", ") });
      await logFeed("flagged", slot, { generationId: id, categories: m.categories });
      return json<GenerateResponse>({ generation: generationView(row, null) });
    }
  } catch (e) {
    console.error("[generate] moderation failed, continuing:", e instanceof Error ? e.message : e);
  }

  const followupEst = estimateFollowupUsd(references.length);
  const genEst = estimateGenerationUsd(references.length);
  const est = askQuestions ? followupEst + genEst : genEst;
  let row;
  try {
    row = await reserveAndInsertGeneration({
      id,
      slot,
      est,
      status: askQuestions ? "asking" : "generating",
      askQuestions,
      inputs: design,
      refs: references,
      modelText: MODELS.text,
      modelImage: MODELS.image,
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new ApiErr("busy", BUSY);
    throw e;
  }
  if (!row) {
    const t = await q1("SELECT spend_usd, reserved_usd, budget_usd FROM teams WHERE slot = $1", [slot]);
    if (!t) throw new ApiErr("unauthorized", "Your team isn't registered any more. Join again with your code.");
    const left = Math.max(0, Number(t.budget_usd) - Number(t.spend_usd) - Number(t.reserved_usd));
    throw new ApiErr(
      "budget",
      `Not enough budget left for another generation ($${left.toFixed(2)} left, about $${est.toFixed(2)} needed). Submit your best one, or ask the presenter.`,
    );
  }

  const input: DesignInput = { ...design, references };
  after(() =>
    withDeadline(startedAt, id, slot, () =>
      askQuestions ? runFollowups(id, slot, epoch, input, followupEst) : runGeneration(id, slot, epoch, input, []),
    ),
  );
  return json<GenerateResponse>({ generation: generationView(row, null) });
});
