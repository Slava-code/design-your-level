"use client";

import { useEffect, useMemo, useState } from "react";
import type { AnswersResponse, CancelResponse, GenerationView, SubmitResponse } from "@/lib/types";
import { Button, ProgressStages, useToast, cx } from "@/components/ui";
import { post, cr } from "./api";
import { Storyboard, Captions } from "./Storyboard";
import { useNow } from "./useNow";
import s from "./design.module.css";

type Props = {
  gen: GenerationView | null;
  version: number;
  isLatest: boolean;
  submittedId: string | null;
  canSubmit: boolean;
  refresh: () => Promise<void>;
  onEdit: () => void;
  onRestore: (g: GenerationView) => void;
  restoreMatches: boolean;
};

/** Right-hand (or second tab) panel: whatever the selected generation needs right now. */
export function Board(props: Props) {
  const { gen } = props;
  if (!gen) return <EmptyBoard />;
  switch (gen.status) {
    case "asking":
      return <Working gen={gen} mode="asking" />;
    case "generating":
      return <Working gen={gen} mode="drawing" />;
    case "questions":
      return <Questions key={gen.id} gen={gen} refresh={props.refresh} onEdit={props.onEdit} />;
    case "done":
      return <Result {...props} gen={gen} />;
    default:
      return <Failed gen={gen} version={props.version} onEdit={props.onEdit} />;
  }
}

// ------------------------------------------------------------------------------------------ empty

function EmptyBoard() {
  return (
    <div className={s.empty}>
      <div className={s.emptyArt} aria-hidden />
      <h2 className={s.emptyTitle}>Your storyboard appears here</h2>
      <p className={s.emptyText}>
        Four panels: entering the level, the enemy, finding the ability, and solving the puzzle at the exit.
      </p>
    </div>
  );
}

// ------------------------------------------------------------------------------------------ working

const ASK_STAGES = [
  { id: "read", label: "Reading your design", hint: "Checking what the artist can picture" },
  { id: "think", label: "Thinking up questions", hint: "Only about the gaps. Usually 5-10 seconds." },
];
const DRAW_STAGES = [
  { id: "read", label: "Reading your design", hint: "Every word you wrote goes in" },
  { id: "brief", label: "Writing the artist brief", hint: "Turning your design into 4 panels" },
  { id: "draw", label: "Drawing your storyboard", hint: "Sketching all four panels at once" },
  { id: "ink", label: "Inking the panels", hint: "Final details. Nearly there." },
];
const ASK_T = [2.5];
const DRAW_T = [3, 9, 22];

const TIPS = [
  "Meanwhile: is it clear how the enemy warns the player?",
  "Meanwhile: what does solving the puzzle change in the room?",
  "Meanwhile: say what each room is made of. Light, materials, size.",
  "Meanwhile: does the ability help with the puzzle or the enemy?",
  "You can keep editing your design while the artist works.",
];

function Working({ gen, mode }: { gen: GenerationView; mode: "asking" | "drawing" }) {
  const now = useNow(500);
  const start = Date.parse(gen.stageStartedAt);
  const elapsed = Number.isFinite(start) && now ? Math.max(0, (now - start) / 1000) : 0;
  const stages = mode === "asking" ? ASK_STAGES : DRAW_STAGES;
  const t = mode === "asking" ? ASK_T : DRAW_T;
  const current = t.filter((x) => elapsed >= x).length;
  const slow = elapsed > (mode === "asking" ? 25 : 75);
  const tip = TIPS[Math.floor(elapsed / 6) % TIPS.length];

  return (
    <div className={s.working}>
      <div className={s.machineWrap} aria-hidden>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/art/loading-machine.png" alt="" className={s.machine} width={1000} height={951} />
        <span className={s.machineGlow} />
      </div>
      <div className={s.workingBody}>
        <ProgressStages
          title={mode === "asking" ? "The artist is reading" : "Drawing your storyboard"}
          stages={stages}
          current={current}
          startedAt={gen.stageStartedAt}
        />
        <p className={s.eta}>
          {mode === "asking"
            ? "A few quick questions are coming. Usually under 10 seconds."
            : slow
              ? "Taking longer than usual. Still working, hang tight."
              : "Usually 20-30 seconds, sometimes up to a minute."}
        </p>
        {mode === "drawing" && (
          <p className={s.tip} key={tip}>
            {tip}
          </p>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------------------ questions

function Questions({ gen, refresh, onEdit }: { gen: GenerationView; refresh: () => Promise<void>; onEdit: () => void }) {
  const toast = useToast();
  const qs = useMemo(() => gen.questions ?? [], [gen.questions]);
  const [answers, setAnswers] = useState<string[]>(() => qs.map(() => ""));
  const [skipped, setSkipped] = useState<boolean[]>(() => qs.map(() => false));
  const [busy, setBusy] = useState<"draw" | "cancel" | null>(null);

  async function draw(e?: React.FormEvent) {
    e?.preventDefault();
    if (busy) return;
    setBusy("draw");
    const r = await post<AnswersResponse>(`/api/generate/${gen.id}/answers`, {
      answers: answers.map((a, i) => (skipped[i] ? "" : a.trim())),
    });
    setBusy(null);
    if (!r.ok) {
      if (r.error.code === "flagged") toast.error(r.error.error, { title: "Reword an answer" });
      else toast.error(r.error.error);
    }
    await refresh();
  }

  async function cancel() {
    if (busy) return;
    setBusy("cancel");
    const r = await post<CancelResponse>(`/api/generate/${gen.id}/cancel`);
    setBusy(null);
    if (!r.ok) toast.error(r.error.error);
    await refresh();
    onEdit();
  }

  const answered = answers.filter((a, i) => !skipped[i] && a.trim()).length;

  return (
    <form className={s.questions} onSubmit={draw}>
      <div className={s.qHead}>
        <p className={s.qKicker}>Before the artist draws</p>
        <h2 className={s.qTitle}>
          {qs.length === 1 ? "One quick question" : `${qs.length} quick questions`}
        </h2>
        <p className={s.qLead}>One line each. Skip anything you don&apos;t care about.</p>
      </div>
      <ol className={cx(s.qStack, "stagger")}>
        {qs.map((q, i) => (
          <li
            key={i}
            className={cx(s.qCard, "surface-paper", "anim-pop-in", skipped[i] && s.qSkipped)}
            style={{ ["--i" as string]: i, ["--tilt" as string]: `${[-1.2, 0.8, -0.5][i % 3]}deg` }}
          >
            <span className={s.qNum}>
              Q{i + 1}
              <span className={s.qOf}>/{qs.length}</span>
            </span>
            <label htmlFor={`qa-${gen.id}-${i}`} className={s.qText}>
              {q}
            </label>
            <div className={s.qRow}>
              <input
                id={`qa-${gen.id}-${i}`}
                className={s.qInput}
                value={skipped[i] ? "" : answers[i]}
                placeholder={skipped[i] ? "Skipped. The artist will decide." : "Your answer"}
                disabled={skipped[i] || !!busy}
                maxLength={500}
                autoComplete="off"
                enterKeyHint={i === qs.length - 1 ? "go" : "next"}
                onChange={(e) => setAnswers((a) => a.map((x, j) => (j === i ? e.target.value : x)))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && i < qs.length - 1) {
                    e.preventDefault();
                    document.getElementById(`qa-${gen.id}-${i + 1}`)?.focus();
                  }
                }}
              />
              <button
                type="button"
                className={cx(s.skip, skipped[i] && s.skipOn)}
                aria-pressed={skipped[i]}
                onClick={() => setSkipped((sk) => sk.map((x, j) => (j === i ? !x : x)))}
                disabled={!!busy}
              >
                {skipped[i] ? "Undo" : "Skip"}
              </button>
            </div>
          </li>
        ))}
      </ol>
      <div className={s.qActions}>
        <Button type="submit" size="xl" block loading={busy === "draw"} loadingText="Sending to the artist" disabled={busy === "cancel"}>
          Draw it
          <span className={s.qCount}>
            {answered} of {qs.length} answered
          </span>
        </Button>
      </div>
      <button type="button" className={cx(s.textBtn, s.qCancel)} onClick={cancel} disabled={!!busy}>
        {busy === "cancel" ? "Cancelling..." : "Never mind, back to editing"}
      </button>
    </form>
  );
}

// ------------------------------------------------------------------------------------------ result

function Result({ gen, version, submittedId, canSubmit, refresh, onRestore, restoreMatches }: Props & { gen: GenerationView }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [justSubmitted, setJustSubmitted] = useState(false);
  const isSubmitted = submittedId === gen.id;
  const hasOther = !!submittedId && !isSubmitted;

  useEffect(() => {
    if (!isSubmitted) setJustSubmitted(false);
  }, [isSubmitted]);

  async function submit() {
    setBusy(true);
    const r = await post<SubmitResponse>("/api/submit", { generationId: gen.id });
    setBusy(false);
    if (!r.ok) {
      toast.error(r.error.error);
      await refresh();
      return;
    }
    setJustSubmitted(true);
    toast.success(hasOther ? `Version ${version} is now your entry.` : `Version ${version} submitted. You can still switch until time is up.`, {
      title: "Submitted",
    });
    await refresh();
  }

  const secs = ((gen.msText ?? 0) + (gen.msImage ?? 0)) / 1000;

  return (
    <article className={s.result} aria-labelledby={`res-${gen.id}`}>
      <header className={s.resultHead}>
        <div>
          <p className={s.resultKicker}>Version {version}</p>
          <h2 id={`res-${gen.id}`} className={s.resultTitle}>
            {gen.inputs.genre ? `${gen.inputs.genre}: ` : ""}
            {gen.inputs.feeling || "Your level"}
          </h2>
        </div>
        {isSubmitted && (
          <span className={cx(s.stamp, justSubmitted && s.stampSlam)} aria-label="Submitted">
            Submitted
          </span>
        )}
      </header>

      <Storyboard gen={gen} hideCaptions className={s.resultBoard} />

      <div className={cx(s.submitBar, isSubmitted && s.submitBarOn)}>
        {isSubmitted ? (
          <p className={s.submitText}>
            <b>This is your entry.</b> The class rates the design you wrote for it.
            {canSubmit ? " You can switch to another version until time is up." : ""}
          </p>
        ) : canSubmit ? (
          <>
            <Button size="lg" block onClick={submit} loading={busy} loadingText="Submitting" variant={hasOther ? "secondary" : "primary"}>
              {hasOther ? "Submit this one instead" : "Submit this storyboard"}
            </Button>
            <p className={s.submitSub}>
              {hasOther ? "Replaces your current entry." : "You can change your pick until design time ends."}
            </p>
          </>
        ) : (
          <p className={s.submitText}>Submissions are closed.</p>
        )}
      </div>

      {gen.panelCaptions && gen.panelCaptions.length > 0 && <Captions caps={gen.panelCaptions} />}

      {gen.changesMade && gen.changesMade.length > 0 && (
        <div className={s.changes}>
          <h3 className={s.changesTitle}>What we changed</h3>
          <p className={s.changesLead}>To get the image model to draw it, the artist adjusted:</p>
          <ul>
            {gen.changesMade.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
      )}

      {gen.imagePrompt && (
        <details className={cx(s.told, "surface-paper")}>
          <summary className={s.toldSum}>
            <span>What the artist was told</span>
            <span className={s.toldChevron} aria-hidden />
          </summary>
          <p className={s.toldText}>{gen.imagePrompt}</p>
          {gen.referenceRoles && gen.referenceRoles.length > 0 && (
            <ul className={s.roles}>
              {gen.referenceRoles.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          )}
        </details>
      )}

      <footer className={s.resultFoot}>
        <span className={s.resultMeta}>
          {cr(gen.costUsd)} {secs > 0 ? ` · ${Math.round(secs)}s` : ""}
          {gen.askedQuestions ? " · with questions" : ""}
        </span>
        {canSubmit && (
          <button type="button" className={s.textBtn} onClick={() => onRestore(gen)} disabled={restoreMatches}>
            {restoreMatches ? "Form matches this version" : "Edit from this version"}
          </button>
        )}
      </footer>
    </article>
  );
}

// ------------------------------------------------------------------------------------------ failed

function Failed({ gen, version, onEdit }: { gen: GenerationView; version: number; onEdit: () => void }) {
  const cancelled = gen.status === "error" && gen.error === "Cancelled.";
  const title =
    gen.status === "flagged"
      ? "The safety filter stopped this one"
      : gen.status === "refused"
        ? "The artist wouldn't draw this version"
        : cancelled
          ? "Cancelled"
          : "Something went wrong";
  const charged = gen.costUsd > 0.0005;
  const budgetLine =
    gen.status === "flagged"
      ? "Nothing was charged."
      : charged
        ? `This attempt used ${cr(gen.costUsd)}.`
        : "Nothing was charged.";
  const advice =
    gen.status === "refused"
      ? "Horror itself is fine: dread, monsters and darkness all work."
      : gen.status === "flagged"
      ? "Horror is fine: dread, monsters and darkness all work. Keep gore implied and describe characters in your own words (not as famous ones or real people), then try again."
      : cancelled
        ? "No problem. Edit your design and draw when you're ready."
        : "This usually works on a second try.";

  return (
    <div className={cx(s.failed, s[`f-${gen.status}`])} role="status">
      <span className={s.failGlyph} aria-hidden>
        <span>{cancelled ? "--" : "!"}</span>
      </span>
      <p className={s.resultKicker}>Version {version}</p>
      <h2 className={s.failTitle}>{title}</h2>
      {!cancelled && gen.error && <p className={s.failMsg}>{gen.error}</p>}
      <p className={s.failAdvice}>{advice}</p>
      <p className={s.failBudget}>{budgetLine}</p>
      <Button size="lg" onClick={onEdit} variant="secondary">
        Back to editing
      </Button>
    </div>
  );
}
