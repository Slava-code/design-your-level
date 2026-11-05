// POST /api/generate/[id]/answers: answer (or skip with "") the follow-up questions and start the image.
import { after } from "next/server";
import type { AnswersRequest, AnswersResponse, DesignFields, RefImage } from "@/lib/types";
import { moderate, estimateGenerationUsd, type DesignInput, type QA } from "@/lib/ai";
import { route, json, readJson, ApiErr } from "@/lib/server/http";
import { requireTeam, requirePhase } from "@/lib/server/event";
import { parseAnswers } from "@/lib/server/validate";
import { q1 } from "@/lib/server/db";
import { reserveForAnswers } from "@/lib/server/budget";
import { generationView } from "@/lib/server/views";
import { runGeneration, withDeadline, MSG } from "@/lib/server/pipeline";
import { creditsLabel } from "@/lib/credits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const startedAt = Date.now();
  const { slot, event } = await requireTeam();
  requirePhase(event, ["DESIGN"], "Generating");
  const { id } = await ctx.params;
  const body = await readJson<Partial<AnswersRequest>>(req);
  const gen = await q1("SELECT * FROM generations WHERE id = $1 AND slot = $2", [id, slot]);
  if (!gen) throw new ApiErr("not_found", "Generation not found.");
  if (gen.status !== "questions") throw new ApiErr("conflict", "This generation isn't waiting for answers any more.");
  const questions: string[] = Array.isArray(gen.questions) ? gen.questions.map(String) : [];
  const answers = parseAnswers(body.answers ?? [], questions.length);

  const answerText = answers.filter(Boolean).join("\n");
  if (answerText) {
    try {
      const m = await moderate(answerText);
      if (m.flagged) throw new ApiErr("flagged", MSG.flagged);
    } catch (e) {
      if (e instanceof ApiErr) throw e;
      console.error("[answers] moderation failed, continuing:", e instanceof Error ? e.message : e);
    }
  }

  const refs = (Array.isArray(gen.refs) ? gen.refs : []) as RefImage[];
  const est = estimateGenerationUsd(refs.length);
  const row = await reserveForAnswers(id, slot, est, answers);
  if (!row) {
    const now = await q1(
      "SELECT g.status, t.spend_usd, t.reserved_usd, t.budget_usd FROM generations g JOIN teams t ON t.slot = g.slot WHERE g.id = $1",
      [id],
    );
    if (now?.status !== "questions") throw new ApiErr("conflict", "This generation isn't waiting for answers any more.");
    const left = Math.max(0, Number(now.budget_usd) - Number(now.spend_usd) - Number(now.reserved_usd));
    throw new ApiErr("budget", `Not enough credits left to draw this (${creditsLabel(left)} left, up to ${creditsLabel(est)} needed).`);
  }

  const input: DesignInput = { ...(gen.inputs as DesignFields), references: refs };
  const qa: QA[] = questions.map((q, i) => ({ q, a: answers[i] ?? "" })).filter((x) => x.a);
  const epoch = Number(event.epoch);
  after(() => withDeadline(startedAt, id, slot, () => runGeneration(id, slot, epoch, input, qa)));
  const team = await q1("SELECT submitted_generation_id FROM teams WHERE slot = $1", [slot]);
  return json<AnswersResponse>({ generation: generationView(row, team?.submitted_generation_id ?? null) });
});
