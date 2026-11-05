// Row -> API view mappers.
import "server-only";
import type { DesignFields, GenerationAdminView, GenerationView, RefImage, TeamSummary } from "@/lib/types";
import { iso, isoOrNull, num, type Row } from "./db";

const round4 = (n: number) => Math.round(n * 10000) / 10000;

export function teamSummary(t: Row): TeamSummary {
  const spend = num(t.spend_usd);
  const reserved = num(t.reserved_usd);
  const budget = num(t.budget_usd);
  return {
    slot: Number(t.slot),
    name: String(t.name),
    spendUsd: round4(spend),
    reservedUsd: round4(reserved),
    budgetUsd: round4(budget),
    remainingUsd: round4(Math.max(0, budget - spend - reserved)),
    submittedGenerationId: t.submitted_generation_id ?? null,
  };
}

const arr = (v: unknown): string[] | null => (Array.isArray(v) ? v.map(String) : null);

export function generationView(g: Row, submittedId: string | null): GenerationView {
  return {
    id: String(g.id),
    createdAt: iso(g.created_at),
    updatedAt: iso(g.updated_at),
    stageStartedAt: iso(g.stage_at),
    status: g.status,
    askedQuestions: !!g.ask_questions,
    inputs: g.inputs as DesignFields,
    references: (Array.isArray(g.refs) ? g.refs : []) as RefImage[],
    questions: arr(g.questions),
    answers: arr(g.answers),
    imagePrompt: g.image_prompt ?? null,
    panelCaptions: arr(g.panel_captions),
    referenceRoles: arr(g.reference_roles),
    changesMade: arr(g.changes_made),
    imageUrl: g.image_url ?? null,
    error: g.error ?? null,
    costUsd: round4(num(g.cost_usd)),
    msText: g.ms_text == null ? null : Number(g.ms_text),
    msImage: g.ms_image == null ? null : Number(g.ms_image),
    submitted: submittedId != null && submittedId === g.id,
  };
}

export function generationAdminView(g: Row, submittedId: string | null): GenerationAdminView {
  return {
    ...generationView(g, submittedId),
    slot: Number(g.slot),
    reservedUsd: round4(num(g.reserved_usd)),
    modelText: g.model_text ?? null,
    modelImage: g.model_image ?? null,
    errorDetail: g.error_detail ?? null,
  };
}

export { isoOrNull };
