"use client";

import { useEffect, useRef, useState } from "react";
import { SCORE_KEYS, type AssignedDesign, type Scores, type TeamState, type VoteResponse } from "@/lib/types";
import { Button, ScoreInput, type Score, useToast, cx } from "@/components/ui";
import { post } from "./api";
import { Storyboard } from "./Storyboard";
import s from "./vote.module.css";

type Partial4 = { level: Score | null; enemy: Score | null; ability: Score | null; puzzle: Score | null };
type SaveState = "idle" | "saving" | "saved" | "error";

const EMPTY: Partial4 = { level: null, enemy: null, ability: null, puzzle: null };
const ASPECT_HINT: Record<keyof Scores, string> = {
  level: "Does the space, from start to exit, create the feeling?",
  enemy: "Does the enemy create the feeling?",
  ability: "Does the ability fit and matter?",
  puzzle: "Is the puzzle clear, and does it fit the feeling?",
};
const ASPECT_LABEL: Record<keyof Scores, string> = { level: "Level", enemy: "Enemy", ability: "Ability", puzzle: "Puzzle" };

type Full4 = { level: Score; enemy: Score; ability: Score; puzzle: Score };
const complete = (p: Partial4): p is Full4 => SCORE_KEYS.every((k) => p[k] !== null);

type Props = { state: TeamState; refresh: () => Promise<void> };

/** VOTING: rate each assigned design 1-5 on the four aspects. One design at a time; saves automatically. */
export function VotingScreen({ state, refresh }: Props) {
  const toast = useToast();
  const assigned = state.voting?.assigned ?? [];
  const [idx, setIdx] = useState(0);
  const [scores, setScores] = useState<Record<string, Partial4>>({});
  const [save, setSave] = useState<Record<string, SaveState>>({});
  const timers = useRef<Record<string, number>>({});
  const topRef = useRef<HTMLDivElement>(null);

  // Seed local scores from server votes for targets we haven't touched locally.
  useEffect(() => {
    setScores((cur) => {
      let changed = false;
      const next = { ...cur };
      for (const a of assigned) {
        if (!next[a.target]) {
          next[a.target] = a.myVote ? { ...(a.myVote as Partial4) } : { ...EMPTY };
          changed = true;
        }
      }
      return changed ? next : cur;
    });
    setSave((cur) => {
      let changed = false;
      const next = { ...cur };
      for (const a of assigned) {
        if (!next[a.target] && a.myVote) {
          next[a.target] = "saved";
          changed = true;
        }
      }
      return changed ? next : cur;
    });
  }, [assigned]);

  useEffect(() => () => Object.values(timers.current).forEach((t) => window.clearTimeout(t)), []);

  async function send(target: string, sc: Scores, attempt = 0) {
    setSave((v) => ({ ...v, [target]: "saving" }));
    const r = await post<VoteResponse>("/api/vote", { target, scores: sc });
    if (r.ok) {
      setSave((v) => ({ ...v, [target]: "saved" }));
      void refresh();
      return;
    }
    if (r.status === 0 && attempt < 3) {
      timers.current[target] = window.setTimeout(() => void send(target, sc, attempt + 1), 1500 * (attempt + 1));
      return;
    }
    setSave((v) => ({ ...v, [target]: "error" }));
    toast.error(r.error.error, { title: "Vote not saved" });
    if (r.error.code === "phase") void refresh();
  }

  function setScore(target: string, k: keyof Scores, v: Score) {
    const next = { ...(scores[target] ?? EMPTY), [k]: v };
    setScores((cur) => ({ ...cur, [target]: next }));
    if (complete(next)) {
      window.clearTimeout(timers.current[target]);
      setSave((cur) => ({ ...cur, [target]: "saving" }));
      timers.current[target] = window.setTimeout(() => void send(target, next), 350);
    }
  }

  if (!state.voting || assigned.length === 0) {
    return (
      <main className={s.vote}>
        <div className={s.none}>
          <p className={s.kicker}>Voting</p>
          <h1 className={s.noneTitle}>Nothing to rate</h1>
          <p className={s.noneText}>
            {state.voting
              ? "There aren't any other designs for your team to rate this round. Watch the big screen."
              : "Voting is getting set up. Hang on a second."}
          </p>
        </div>
      </main>
    );
  }

  const cur = assigned[Math.min(idx, assigned.length - 1)];
  const curScores = scores[cur.target] ?? EMPTY;
  const doneLocal = assigned.filter((a) => save[a.target] === "saved").length;
  const allDone = doneLocal === assigned.length;
  const isLast = idx >= assigned.length - 1;
  const curDone = complete(curScores);

  const go = (i: number) => {
    setIdx(i);
    window.requestAnimationFrame(() => topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  return (
    <main className={s.vote}>
      <div ref={topRef} className={s.top}>
        <div className={s.topRow}>
          <div>
            <p className={s.kicker}>Voting</p>
            <h1 className={s.title}>Rate {assigned.length} designs</h1>
          </div>
          <div className={s.progress} aria-live="polite">
            <span className={s.progNum}>
              {doneLocal}/{assigned.length}
            </span>
            <span className={s.progLabel}>rated</span>
          </div>
        </div>
        <p className={s.reminder}>
          Rate the <b>design</b>, not the art. Read what they wrote first.
        </p>
        <ol className={s.pager} aria-label="Designs to rate">
          {assigned.map((a, i) => {
            const st = save[a.target];
            return (
              <li key={a.target}>
                <button
                  type="button"
                  className={cx(s.pageBtn, i === idx && s.pageOn, st === "saved" && s.pageDone, st === "error" && s.pageErr)}
                  onClick={() => go(i)}
                  aria-current={i === idx ? "step" : undefined}
                  aria-label={`Design ${a.position}${st === "saved" ? ", rated" : ""}`}
                >
                  <span className={s.pageNum}>{a.position}</span>
                  <span className={s.pageMark} aria-hidden>
                    {st === "saved" ? "rated" : st === "saving" ? "saving" : ""}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>

      {allDone && (
        <div className={cx(s.allDone, "anim-pop-in")} role="status">
          <b>All rated.</b> You can change any score until voting ends.
        </div>
      )}

      <div className={s.stage}>
        <DesignCard key={cur.target} d={cur} total={assigned.length} />

        <section className={s.scoring} aria-labelledby={`score-h-${cur.target}`}>
          <h2 id={`score-h-${cur.target}`} className={s.scoringTitle}>
            Your scores for design {cur.position}
          </h2>
          <div className={s.scoreList}>
            {SCORE_KEYS.map((k) => (
              <ScoreInput
                key={k}
                name={`v-${cur.target}-${k}`}
                label={ASPECT_LABEL[k]}
                aspect={k}
                hint={ASPECT_HINT[k]}
                value={curScores[k]}
                onChange={(v) => setScore(cur.target, k, v)}
              />
            ))}
          </div>
          <div className={s.saveLine} aria-live="polite">
            {save[cur.target] === "saving" ? (
              <span className={s.saving}>Saving...</span>
            ) : save[cur.target] === "saved" ? (
              <span className={s.saved}>Saved</span>
            ) : save[cur.target] === "error" ? (
              <span className={s.saveErr}>
                Not saved.{" "}
                <button type="button" className={s.retry} onClick={() => curDone && void send(cur.target, curScores as Scores)}>
                  Retry
                </button>
              </span>
            ) : (
              <span className={s.pending}>
                {SCORE_KEYS.filter((k) => curScores[k] === null).length} left to score
              </span>
            )}
          </div>
          <div className={s.nav}>
            <Button variant="ghost" size="lg" onClick={() => go(idx - 1)} disabled={idx === 0}>
              Back
            </Button>
            <Button size="lg" onClick={() => go(isLast ? firstUnrated(assigned, save, idx) : idx + 1)} disabled={isLast && allDone}>
              {isLast ? (allDone ? "All done" : "Next unrated") : "Next design"}
            </Button>
          </div>
        </section>
      </div>
    </main>
  );
}

function firstUnrated(assigned: AssignedDesign[], save: Record<string, SaveState>, fallback: number) {
  const i = assigned.findIndex((a) => save[a.target] !== "saved");
  return i === -1 ? fallback : i;
}

function DesignCard({ d, total }: { d: AssignedDesign; total: number }) {
  const f = d.inputs;
  const rows: { k: "level" | "enemy" | "ability" | "puzzle"; label: string }[] = [
    { k: "level", label: "Level" },
    { k: "enemy", label: "Enemy" },
    { k: "ability", label: "Ability" },
    { k: "puzzle", label: "Puzzle" },
  ];
  return (
    <article className={cx(s.card, "surface-paper", "anim-rise-in")} aria-label={`Design ${d.position} of ${total}`}>
      <header className={s.cardHead}>
        <span className={s.cardNum}>
          Design {d.position}
          <span className={s.cardOf}> / {total}</span>
        </span>
        <div className={s.tags}>
          {f.genre && <span className={s.tag}>{f.genre}</span>}
          {f.feeling && (
            <span className={cx(s.tag, s.tagFeel)}>
              <span className={s.tagKey}>Feeling</span> {f.feeling}
            </span>
          )}
          {f.artStyle && (
            <span className={s.tag}>
              <span className={s.tagKey}>Style</span> {f.artStyle}
            </span>
          )}
        </div>
      </header>
      <dl className={s.aspects}>
        {rows.map((r) => (
          <div key={r.k} className={s.aspect} data-aspect={r.k}>
            <dt className={s.aspectName}>
              <span className={s.diamond} aria-hidden />
              {r.label}
            </dt>
            <dd className={s.aspectText}>{f[r.k] || <span className={s.blank}>(left blank)</span>}</dd>
          </div>
        ))}
      </dl>
      {d.imageUrl && (
        <div className={s.art}>
          <p className={s.artLabel}>Their storyboard (tap to zoom)</p>
          <Storyboard gen={d} small hideCaptions alt={`Storyboard for design ${d.position}`} />
        </div>
      )}
    </article>
  );
}
