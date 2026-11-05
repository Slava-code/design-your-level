// Background AI work for a generation, run with after() so the HTTP response returns immediately.
// Every state change is guarded by the expected current status, so a sweeper/cancel that got there
// first wins and late results are dropped (their real cost is still charged).
import "server-only";
import { askFollowups, writeImagePrompt, generateStoryboard, friendlyAiError, type DesignInput, type QA } from "@/lib/ai";
import { q1 } from "./db";
import { charge, finish, releasePart } from "./budget";
import { logFeed } from "./feed";
import { putGeneratedImage } from "./blob";

const ms = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? Math.round(n) : null);
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 500);

export const MSG = {
  error: "Something went wrong while making this one. You were only charged for what was used. Try again.",
  refused: "The image model wouldn't draw this version. Try toning down the most graphic part, then regenerate.",
  timeout: "This one took too long and was stopped. You were only charged for what was used. Try again.",
  flagged: "That text tripped the safety filter, so nothing was generated or charged. Reword the most graphic or personal part and try again.",
};

async function fail(id: string, slot: number, from: string[], e: unknown) {
  console.error(`[pipeline] generation ${id} failed:`, e instanceof Error ? e.stack || e.message : e);
  // Quota / rate limit / key / outage on any AI step: say so, instead of the generic "try again".
  const friendly = await friendlyAiError(e).catch(() => null);
  const row = await finish(id, from, "error", { error: friendly?.message ?? MSG.error, errorDetail: errText(e) }).catch(() => null);
  if (row) {
    await logFeed("error", slot, {
      generationId: id,
      message: (friendly?.quota ? "OPENAI QUOTA HIT: " : "") + errText(e).slice(0, 120),
      ...(friendly?.quota ? { quota: true } : {}),
    });
  }
}

/** Hard stop for the background work, measured from the start of the route invocation, so a slow chain
 *  of AI calls marks the generation as an error itself before Vercel's maxDuration (300 s) kills the
 *  function and leaves it stuck until the sweeper. Late results are dropped by the status guards. */
export const PIPELINE_DEADLINE_MS = 285_000;

export async function withDeadline(startedAt: number, id: string, slot: number, work: () => Promise<void>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const left = Math.max(5_000, PIPELINE_DEADLINE_MS - (Date.now() - startedAt));
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), left);
  });
  try {
    const r = await Promise.race([work().then(() => "done" as const), timeout]);
    if (r === "timeout") {
      const row = await finish(id, ["asking", "generating"], "error", { error: MSG.timeout, errorDetail: "pipeline deadline" }).catch(() => null);
      if (row) await logFeed("error", slot, { generationId: id, message: "timed out (pipeline deadline)" });
    }
  } finally {
    clearTimeout(timer);
  }
}

/** asking -> questions (or straight on to generating if there are no questions). */
export async function runFollowups(id: string, slot: number, epoch: number, design: DesignInput, followupEst: number): Promise<void> {
  try {
    const r = await askFollowups(design);
    await charge(id, r.cost?.usd ?? 0);
    const questions = (Array.isArray(r.questions) ? r.questions : [])
      .map((x) => String(x ?? "").trim())
      .filter(Boolean)
      .slice(0, 3);
    if (questions.length > 0) {
      const row = await finish(id, ["asking"], "questions", { questions, msText: ms(r.ms) });
      if (row) await logFeed("asked", slot, { generationId: id, count: questions.length });
      return;
    }
    // No questions: keep the image reservation and go straight on.
    await releasePart(id, followupEst, ["asking"]);
    const row = await finish(id, ["asking"], "generating", { questions: [], msText: ms(r.ms) }, { releaseAll: false, stage: true });
    if (row) {
      await logFeed("asked", slot, { generationId: id, count: 0 });
      await runGeneration(id, slot, epoch, design, []);
    }
  } catch (e) {
    await fail(id, slot, ["asking"], e);
  }
}

/** generating -> done | refused | error. */
export async function runGeneration(id: string, slot: number, epoch: number, design: DesignInput, qa: QA[]): Promise<void> {
  try {
    const p = await writeImagePrompt(design, qa);
    await charge(id, p.cost?.usd ?? 0);
    const still = await q1(
      `UPDATE generations SET image_prompt = $2, panel_captions = $3::jsonb, reference_roles = $4::jsonb, changes_made = $5::jsonb,
              ms_text = COALESCE(ms_text, 0) + COALESCE($6, 0), updated_at = now()
        WHERE id = $1 AND status = 'generating' RETURNING id`,
      [id, p.imagePrompt, JSON.stringify(p.panelCaptions ?? []), JSON.stringify(p.referenceRoles ?? []), JSON.stringify(p.changesMade ?? []), ms(p.ms)],
    );
    if (!still) return; // swept or cancelled meanwhile: don't spend on the image

    const s = await generateStoryboard(p.imagePrompt, design.references);
    await charge(id, s.cost?.usd ?? 0);
    if (s.ok) {
      const url = await putGeneratedImage(epoch, slot, id, s.bytes, s.contentType);
      const row = await finish(id, ["generating"], "done", { imageUrl: url, msImage: ms(s.ms) });
      if (row) await logFeed("generated", slot, { generationId: id, costUsd: Number(row.cost_usd), imageUrl: url });
    } else if (s.refused) {
      const row = await finish(id, ["generating"], "refused", { error: s.reason || MSG.refused, errorDetail: s.reason?.slice(0, 500) ?? "refused", msImage: ms(s.ms) });
      if (row) await logFeed("refused", slot, { generationId: id, costUsd: Number(row.cost_usd) });
    } else {
      const row = await finish(id, ["generating"], "error", { error: s.reason || MSG.error, errorDetail: s.reason?.slice(0, 500) ?? "image failed", msImage: ms(s.ms) });
      if (row) await logFeed("error", slot, { generationId: id, message: (s.reason ?? "image failed").slice(0, 120) });
    }
  } catch (e) {
    await fail(id, slot, ["generating"], e);
  }
}
