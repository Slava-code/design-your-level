"use client";

import { useEffect, useState } from "react";
import { Confetti } from "./Confetti";
import { cx } from "./cx";
import s from "./Podium.module.css";

export type PodiumEntry = {
  place: 1 | 2 | 3;
  name: string;
  /** Storyboard image (landscape). Optional: a placeholder pattern is shown if missing. */
  imageUrl?: string | null;
  /** Average score (e.g. 4.25). Rendered with 2 decimals. */
  score: number;
};

export type PodiumProps = {
  entries: PodiumEntry[];
  /** 0 = nothing revealed, 1 = 3rd, 2 = 3rd + 2nd, 3 = all (winner, confetti, trophy). */
  revealStep: 0 | 1 | 2 | 3;
  /** Caption under the score. Default "avg score". */
  scoreLabel?: string;
  /** Fire confetti on reveals. Default true. */
  confetti?: boolean;
  /** Trophy image path. Default /art/trophy.png (hidden gracefully if missing). */
  trophySrc?: string;
  /** Show the trophy above the winner's card. Default true (the projector puts it in its headline instead). */
  trophy?: boolean;
  /** Hide the winner's name under its card (when a headline already shows it). Default false. */
  hideWinnerName?: boolean;
  className?: string;
};

const ORDER: Array<1 | 2 | 3> = [2, 1, 3];
const REVEAL_AT: Record<1 | 2 | 3, number> = { 3: 1, 2: 2, 1: 3 };
const SUFFIX: Record<1 | 2 | 3, string> = { 1: "st", 2: "nd", 3: "rd" };

function fmtScore(n: number) {
  return Number.isFinite(n) ? n.toFixed(2) : "--";
}

/** Top-3 podium reveal (3rd, then 2nd, then the winner with confetti + trophy). Scales to its container width. */
export function Podium({
  entries,
  revealStep,
  scoreLabel = "avg score",
  confetti = true,
  trophySrc = "/art/trophy.png",
  trophy = true,
  hideWinnerName = false,
  className,
}: PodiumProps) {
  const [trophyOk, setTrophyOk] = useState(true);
  const [encore, setEncore] = useState(0);
  const byPlace = (p: 1 | 2 | 3) => entries.find((e) => e.place === p);

  useEffect(() => {
    if (revealStep < 3) return;
    const t = window.setTimeout(() => setEncore((n) => n + 1), 900);
    return () => window.clearTimeout(t);
  }, [revealStep]);

  return (
    <div className={cx(s.podium, revealStep >= 3 && s.won, className)} data-step={revealStep}>
      {confetti && (
        <>
          <Confetti fire={revealStep > 0 ? revealStep : 0} pieces={revealStep >= 3 ? 280 : 70} origin={revealStep >= 3 ? "bottom" : "center"} />
          <Confetti fire={revealStep >= 3 ? encore : 0} pieces={160} origin="top" />
        </>
      )}
      <div className={s.stage}>
        {ORDER.map((place) => {
          const e = byPlace(place);
          const shown = revealStep >= REVEAL_AT[place];
          const winner = place === 1 && shown;
          return (
            <div key={place} className={cx(s.col, s[`p${place}`], shown && s.shown, winner && s.winner)}>
              <div className={s.cardSlot}>
                {winner && (
                  <div className={s.rays} aria-hidden>
                    <span />
                  </div>
                )}
                {shown ? (
                  <div className={s.card} aria-live="polite">
                    {winner && trophy && (
                      <div className={s.trophyWrap} aria-hidden>
                        {trophyOk ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={trophySrc} alt="" className={s.trophy} onError={() => setTrophyOk(false)} />
                        ) : (
                          <span className={s.trophyFallback}>WINNER</span>
                        )}
                      </div>
                    )}
                    <div className={s.frame}>
                      {e?.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={e.imageUrl} alt={`Storyboard by ${e.name}`} />
                      ) : (
                        <div className={s.noImg} aria-hidden />
                      )}
                    </div>
                    {!(winner && hideWinnerName) && <div className={s.name}>{e ? e.name : "No entry"}</div>}
                    {e && (
                      <div className={s.score}>
                        <span className={s.scoreNum}>{fmtScore(e.score)}</span>
                        <span className={s.scoreLabel}>{scoreLabel}</span>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className={s.mystery} aria-label={`${place}${SUFFIX[place]} place, not revealed yet`}>
                    <span className={s.q}>?</span>
                  </div>
                )}
              </div>
              <div className={s.block}>
                <span className={s.place}>
                  {place}
                  <small>{SUFFIX[place]}</small>
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
