"use client";

import type { RankingEntry, TeamState } from "@/lib/types";
import { Confetti, cx } from "@/components/ui";
import { Storyboard } from "./Storyboard";
import s from "./shell.module.css";

const PLACE = ["", "1st", "2nd", "3rd"];
const PLACE_WORD = ["", "WINNER", "SECOND", "THIRD"];

/** REVEAL: "Eyes on the big screen", then a celebration if this team lands on the podium. */
export function RevealScreen({ state }: { state: TeamState }) {
  const reveal = state.reveal;
  const mine = reveal?.revealed.find((e) => e.slot === state.team.slot) ?? null;
  const step = reveal?.step ?? 0;
  const max = reveal?.maxStep ?? 0;
  const finished = max > 0 && step >= max;

  if (mine) return <Podium mine={mine} state={state} finished={finished} />;

  return (
    <main className={s.reveal}>
      <div className={s.revealInner}>
        <p className={s.revealKicker}>The results are in</p>
        <h1 className={s.lookUp}>
          <span className={s.lookLine}>Eyes on the</span>
          <span className={s.lookBig}>big screen</span>
        </h1>
        <div className={s.drum} aria-hidden>
          <span />
          <span />
          <span />
        </div>
        {max > 0 && (
          <p className={s.revealProgress} aria-live="polite">
            {finished ? "The podium is set." : step === 0 ? `${max} teams will make the podium.` : `${step} of ${max} revealed`}
          </p>
        )}
        {reveal && reveal.revealed.length > 0 && <RevealedList entries={reveal.revealed} myslot={state.team.slot} />}
        {finished && <p className={s.revealThanks}>Great designs all round. Thanks for playing, {state.team.name}.</p>}
      </div>
    </main>
  );
}

function Podium({ mine, state, finished }: { mine: RankingEntry; state: TeamState; finished: boolean }) {
  const winner = mine.rank === 1;
  return (
    <main className={cx(s.reveal, s.revealWin, winner && s.revealGold)}>
      <Confetti fire={`${state.epoch}-${mine.rank}`} />
      {winner && <Confetti rain />}
      <div className={s.revealInner}>
        {winner && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src="/art/trophy.png" alt="" className={s.trophy} width={682} height={900} />
        )}
        <p className={s.revealKicker}>{state.team.name}</p>
        <h1 className={s.placeBig}>
          <span className={s.placeNum}>{PLACE[mine.rank] ?? `#${mine.rank}`}</span>
          <span className={s.placeWord}>{winner ? "You won!" : "place!"}</span>
        </h1>
        {mine.score != null && (
          <p className={s.placeScore}>
            {mine.score.toFixed(2)} <span>avg score from {mine.ratings} ratings</span>
          </p>
        )}
        {mine.imageUrl && (
          <div className={s.placeBoard}>
            <Storyboard gen={mine} hideCaptions alt="Your winning storyboard" />
          </div>
        )}
        {state.reveal && <RevealedList entries={state.reveal.revealed} myslot={state.team.slot} />}
        {!finished && <p className={s.revealProgress}>Keep watching the big screen...</p>}
      </div>
      <span className="sr-only" role="status">
        Your team placed {PLACE[mine.rank]}. {PLACE_WORD[mine.rank]}
      </span>
    </main>
  );
}

function RevealedList({ entries, myslot }: { entries: RankingEntry[]; myslot: number }) {
  const sorted = [...entries].sort((a, b) => a.rank - b.rank);
  return (
    <ol className={s.revealedList} aria-label="Podium so far">
      {sorted.map((e) => (
        <li key={e.slot} className={cx(s.revealedItem, e.slot === myslot && s.revealedMine, "anim-pop-in")} data-rank={e.rank}>
          <span className={s.revealedPlace}>{PLACE[e.rank] ?? `#${e.rank}`}</span>
          <span className={s.revealedName}>{e.name}</span>
          {e.score != null && <span className={s.revealedScore}>{e.score.toFixed(2)}</span>}
        </li>
      ))}
    </ol>
  );
}

/** CLOSED: thanks screen with the team's submitted storyboard. */
export function ClosedScreen({ state }: { state: TeamState }) {
  const sub = state.generations.find((g) => g.id === state.submittedGenerationId) ?? null;
  const mine = state.reveal?.revealed.find((e) => e.slot === state.team.slot) ?? null;
  return (
    <main className={s.closed}>
      <div className={s.closedInner}>
        <p className={s.revealKicker}>That&apos;s a wrap</p>
        <h1 className={s.closedTitle}>
          Thanks for playing,<br />
          <span className={s.closedName}>{state.team.name}</span>
        </h1>
        {mine && <p className={s.closedPlace}>You placed {PLACE[mine.rank]}. Nice work.</p>}
        {sub && sub.imageUrl ? (
          <section className={cx(s.closedCard, "surface-paper")}>
            <h2 className={s.closedCardTitle}>Your entry</h2>
            <Storyboard gen={sub} alt="Your submitted storyboard" />
          </section>
        ) : (
          <p className={s.closedText}>Your team didn&apos;t submit a storyboard this time, but your votes counted.</p>
        )}
        {state.reveal && state.reveal.revealed.length > 0 && (
          <div className={s.closedPodium}>
            <h2 className={s.closedCardTitle}>Podium</h2>
            <RevealedList entries={state.reveal.revealed} myslot={state.team.slot} />
          </div>
        )}
        <p className={s.closedText}>Tip: tap the storyboard to open it, then long-press the image to save it to your phone.</p>
      </div>
    </main>
  );
}
