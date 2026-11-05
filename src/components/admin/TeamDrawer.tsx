"use client";

import { useEffect, useRef, useState } from "react";
import { BudgetMeter, Button, StatusPill, type Status } from "@/components/ui";
import type { AdminTeamDetailResponse, AdminTeamRow, DesignFields, GenerationAdminView, GenerationStatus } from "@/lib/types";
import { activityPill, api, clock, secs, usd } from "./lib";
import s from "./drawer.module.css";

const FIELD_LABEL: Record<keyof DesignFields, string> = {
  genre: "Genre",
  feeling: "Feeling",
  artStyle: "Art style",
  level: "Level",
  enemy: "Enemy",
  ability: "Ability",
  puzzle: "Puzzle",
};
const FIELD_ORDER: (keyof DesignFields)[] = ["genre", "feeling", "artStyle", "level", "enemy", "ability", "puzzle"];

const GEN_PILL: Record<GenerationStatus, { status: Status; label: string }> = {
  asking: { status: "asking", label: "Asking" },
  questions: { status: "asking", label: "Answering" },
  generating: { status: "generating", label: "Generating" },
  done: { status: "done", label: "Done" },
  refused: { status: "error", label: "Refused" },
  error: { status: "error", label: "Error" },
  flagged: { status: "error", label: "Flagged" },
};

/** Right-hand drawer with every generation of one team (inputs, Q&A, prompt, cost, timings, errors). */
export function TeamDrawer({
  slot,
  row,
  onClose,
  onResetBudget,
}: {
  slot: number | null;
  row: AdminTeamRow | null;
  onClose: () => void;
  onResetBudget: (row: AdminTeamRow) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [data, setData] = useState<AdminTeamDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const open = slot != null;

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    else if (!open && d.open) d.close();
  }, [open]);

  // Load on open, then refresh whenever the team's live row changes (new generation, status, spend).
  const sig = row ? `${row.generationCount}|${row.activity}|${row.spendUsd}|${row.reservedUsd}|${row.submittedGenerationId}|${row.name}` : "";
  useEffect(() => {
    if (slot == null) {
      setData(null);
      setError(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const r = await api<AdminTeamDetailResponse>(`/api/admin/team/${slot}`);
      if (cancelled) return;
      if (r.ok) {
        setData(r.data);
        setError(null);
      } else setError(r.error);
    })();
    return () => {
      cancelled = true;
    };
  }, [slot, sig]);

  // While something is in flight, also refresh every 3 s so the drawer shows prompts as they arrive.
  const inflight = data?.generations.some((g) => g.status === "asking" || g.status === "generating" || g.status === "questions");
  useEffect(() => {
    if (slot == null || !inflight) return;
    const id = window.setInterval(async () => {
      const r = await api<AdminTeamDetailResponse>(`/api/admin/team/${slot}`);
      if (r.ok) setData(r.data);
    }, 3000);
    return () => window.clearInterval(id);
  }, [slot, inflight]);

  const team = row ?? data?.team ?? null;
  const pill = team ? activityPill(team.activity) : null;
  const totalCost = data?.generations.reduce((a, g) => a + g.costUsd, 0) ?? 0;

  return (
    <dialog
      ref={ref}
      className={`${s.drawer} surface-terminal`}
      aria-labelledby="drawer-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className={s.inner}>
        <header className={s.head}>
          <div className={s.headTop}>
            <div>
              <div className={s.kicker}>Team {slot}</div>
              <h2 id="drawer-title" className={s.title}>
                {team?.name ?? `Team ${slot}`}
              </h2>
            </div>
            <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close team details">
              Close
            </Button>
          </div>
          {team && (
            <div className={s.headMeta}>
              {pill && <StatusPill status={pill.status} label={pill.label} size="sm" />}
              <span className={s.meta}>
                {team.generationCount} generation{team.generationCount === 1 ? "" : "s"} · {usd(totalCost, 3)} total
              </span>
              <span className={s.meta}>joined {clock(team.joinedAt)}</span>
              <div className={s.headBudget}>
                <BudgetMeter unit="credits" spentUsd={team.spendUsd} budgetUsd={team.budgetUsd} reservedUsd={team.reservedUsd} label="Credits" />
              </div>
              <Button size="sm" variant="secondary" onClick={() => onResetBudget(team)} disabled={team.spendUsd <= 0 && team.reservedUsd <= 0}>
                Reset credits
              </Button>
            </div>
          )}
        </header>

        <div className={s.body}>
          {error && <p className={s.err}>{error}</p>}
          {!data && !error && <p className={s.loading}>Loading generations...</p>}
          {data && data.generations.length === 0 && <p className={s.loading}>No generations yet. This team is still drafting.</p>}
          {data?.generations.map((g, i) => (
            <GenerationCard key={g.id} g={g} n={data.generations.length - i} />
          ))}
        </div>
      </div>
    </dialog>
  );
}

function GenerationCard({ g, n }: { g: GenerationAdminView; n: number }) {
  const pill = GEN_PILL[g.status] ?? { status: "idle" as Status, label: g.status };
  return (
    <article className={s.gen} data-submitted={g.submitted || undefined}>
      <header className={s.genHead}>
        <span className={s.genNum}>#{n}</span>
        <StatusPill status={pill.status} label={pill.label} size="sm" />
        {g.submitted && <span className={s.subBadge}>Submitted</span>}
        <span className={s.genMeta}>{clock(g.createdAt)}</span>
        <span className={s.genMeta}>{usd(g.costUsd, 3)}</span>
        <span className={s.genMeta}>
          text {secs(g.msText)} · image {secs(g.msImage)}
        </span>
      </header>

      <div className={s.genGrid}>
        <div className={s.genImgCol}>
          {g.imageUrl ? (
            <a href={g.imageUrl} target="_blank" rel="noreferrer" className={s.genImgLink} title="Open full size">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={g.imageUrl} alt={`Storyboard #${n}`} className={s.genImg} />
            </a>
          ) : (
            <div className={s.genNoImg}>
              {g.status === "asking" || g.status === "generating" ? "Working..." : g.status === "questions" ? "Waiting for answers" : "No image"}
            </div>
          )}
          {g.panelCaptions && g.panelCaptions.length > 0 && (
            <ol className={s.captions}>
              {g.panelCaptions.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ol>
          )}
          {g.references.length > 0 && (
            <div className={s.refs}>
              <span className={s.label}>References</span>
              <div className={s.refRow}>
                {g.references.map((r, i) => (
                  <a key={i} href={r.url} target="_blank" rel="noreferrer" className={s.ref} title={r.field}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={r.url} alt={`Reference ${i + 1} (${r.field})`} />
                    <span>{r.field}</span>
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className={s.genText}>
          {(g.error || g.errorDetail) && (
            <div className={s.errBox}>
              {g.error && <p>{g.error}</p>}
              {g.errorDetail && g.errorDetail !== g.error && <p className={s.errDetail}>{g.errorDetail}</p>}
            </div>
          )}

          <dl className={s.inputs}>
            {FIELD_ORDER.filter((k) => g.inputs[k]?.trim()).map((k) => (
              <div key={k} className={s.inputRow}>
                <dt>{FIELD_LABEL[k]}</dt>
                <dd>{g.inputs[k]}</dd>
              </div>
            ))}
          </dl>

          {g.questions && (
            <div className={s.qa}>
              <span className={s.label}>Follow-ups</span>
              {g.questions.length === 0 ? (
                <p className={s.dim}>The model had no questions.</p>
              ) : (
                <ol>
                  {g.questions.map((q, i) => (
                    <li key={i}>
                      <span className={s.q}>{q}</span>
                      <span className={s.a}>
                        {g.answers == null ? <em>waiting</em> : g.answers[i]?.trim() ? g.answers[i] : <em>skipped</em>}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}

          {g.changesMade && g.changesMade.length > 0 && (
            <div className={s.changes}>
              <span className={s.label}>Changed for the image model</span>
              <ul>
                {g.changesMade.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </div>
          )}

          {g.imagePrompt && (
            <details className={s.prompt}>
              <summary>What the artist was told</summary>
              <p>{g.imagePrompt}</p>
              {g.referenceRoles && g.referenceRoles.length > 0 && (
                <ul className={s.roles}>
                  {g.referenceRoles.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              )}
            </details>
          )}

          <p className={s.models}>
            {g.modelText ?? "--"} / {g.modelImage ?? "--"}
            {g.reservedUsd > 0 && <> · {usd(g.reservedUsd, 3)} reserved</>}
          </p>
          {Object.keys(g.costDetail ?? {}).length > 0 && (
            <p className={s.models}>
              {(["followup", "prompt", "image"] as const)
                .filter((k) => g.costDetail[k])
                .map((k) => {
                  const d = g.costDetail[k];
                  const label = k === "followup" ? "questions" : k === "prompt" ? "prompt writer" : "image";
                  return `${label} ${usd(Number(d.usd ?? 0), 4)}${d.ms ? ` (${(Number(d.ms) / 1000).toFixed(1)}s)` : ""}`;
                })
                .join(" · ")}
            </p>
          )}
        </div>
      </div>
    </article>
  );
}
