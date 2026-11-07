"use client";

import { useEffect, useRef, useState } from "react";
import { Confetti, Podium, StatusPill, Timer, Wordmark, cx, type PodiumEntry } from "@/components/ui";
import type { AdminState, AdminTeamRow } from "@/lib/types";
import { activityPill, PHASE_LABEL } from "./lib";
import { Showcase } from "./Showcase";
import { useLiveState, useNow } from "./useLiveState";
import s from "./screen.module.css";

type Props = { qrSvg: string; playHost: string };

/** Projector view (/screen). Polls view=screen with the admin cookie. Never shows codes. */
export function ScreenApp({ qrSvg, playHost }: Props) {
  const live = useLiveState("screen");

  if (live.status === "loading") {
    return (
      <main className={cx(s.screen, "bg-projector")}>
        <div className={s.centerMsg}>
          <Wordmark size="hero" animate />
        </div>
      </main>
    );
  }
  if (live.status === "anon" || !live.state) {
    return (
      <main className={cx(s.screen, "bg-projector")}>
        <div className={s.centerMsg}>
          <Wordmark size="lg" />
          <p className={s.lockText}>
            {live.anon?.sessionExpired ? "The admin session ended. " : ""}Log in at <span className={s.lockUrl}>/admin</span> in this browser first, then
            reload this tab.
          </p>
        </div>
      </main>
    );
  }
  return <Live state={live.state} offsetMs={live.offsetMs} failures={live.failures} qrSvg={qrSvg} playHost={playHost} />;
}

function Live({ state, offsetMs, failures, qrSvg, playHost }: { state: AdminState; offsetMs: number; failures: number } & Props) {
  const now = useNow(250);
  const remainingMs = state.phaseEndsAt ? Date.parse(state.phaseEndsAt) - (now + offsetMs) : null;
  const timed = state.phase === "DESIGN" || state.phase === "VOTING";
  const finalCountdown = timed && remainingMs != null && remainingMs > 0 && remainingMs <= 10_000;
  const timeUp = timed && remainingMs != null && remainingMs <= 0;

  return (
    <main
      className={cx(s.screen, state.phase === "REVEAL" ? s.revealBg : "bg-projector", finalCountdown && s.final)}
      data-phase={state.phase}
    >
      <header className={s.top}>
        <Wordmark size="sm" layout="inline" />
        <span className={s.phaseTag}>
          <span className={s.phaseDot} aria-hidden />
          {PHASE_LABEL[state.phase]}
        </span>
        <span className={s.urlChip}>{playHost}</span>
      </header>

      <div className={s.stage} key={state.phase}>
        {state.phase === "LOBBY" && <Lobby state={state} qrSvg={qrSvg} playHost={playHost} />}
        {state.phase === "DESIGN" && <Design state={state} offsetMs={offsetMs} timeUp={timeUp} />}
        {state.phase === "VOTING" && <Voting state={state} offsetMs={offsetMs} timeUp={timeUp} />}
        {state.phase === "REVEAL" && <Reveal state={state} />}
        {state.phase === "CLOSED" && <Closed state={state} />}
      </div>

      {finalCountdown && remainingMs != null && (
        <div className={s.finalOverlay} aria-hidden>
          <span className={s.finalNum} key={Math.ceil(remainingMs / 1000)}>
            {Math.ceil(remainingMs / 1000)}
          </span>
          <span className={s.finalLabel}>{state.phase === "DESIGN" ? "Submit your storyboard" : "Finish your ratings"}</span>
        </div>
      )}

      {failures >= 3 && (
        <div className={s.offline} role="status">
          Reconnecting
        </div>
      )}
    </main>
  );
}

/* ---------------------------------------------------------------- LOBBY */

function Lobby({ state, qrSvg, playHost }: { state: AdminState; qrSvg: string; playHost: string }) {
  return (
    <div className={s.lobby}>
      <div className={s.lobbyMain}>
        <div className={s.lobbyText}>
          <span className={s.kicker}>Join the game</span>
          <h1 className={s.url}>
            <span className={s.urlHost}>{playHost.replace(/\.app$/, "")}</span>
            <span className={s.urlTld}>.app</span>
          </h1>
          <p className={s.grab}>
            <span className={s.grabSticker}>Grab a code card from us</span>
          </p>
          <ol className={s.steps}>
            <li>
              <span className={s.stepN}>1</span>Open the site
            </li>
            <li>
              <span className={s.stepN}>2</span>Type your team code
            </li>
            <li>
              <span className={s.stepN}>3</span>Name your team
            </li>
            <li>
              <span className={s.stepN}>4</span>One typist per team, everyone else helps
            </li>
          </ol>
        </div>
        <figure className={s.qrCard}>
          <div className={s.qr} dangerouslySetInnerHTML={{ __html: qrSvg }} role="img" aria-label={`QR code for ${playHost}`} />
          <figcaption className={s.qrCap}>scan to play</figcaption>
        </figure>
      </div>
      <TeamStrip teams={state.teams} />
    </div>
  );
}

function TeamStrip({ teams }: { teams: AdminTeamRow[] }) {
  return (
    <section className={s.strip} aria-label="Teams that joined">
      <div className={s.stripHead}>
        <span className={s.stripCount}>{teams.length}</span>
        <span className={s.stripLabel}>{teams.length === 1 ? "team is in" : "teams are in"}</span>
      </div>
      <div className={s.stripTiles}>
        {teams.length === 0 && <span className={s.waiting}>Waiting for the first team<span className="cursor" /></span>}
        {teams.map((t, i) => (
          <span key={t.slot} className={s.chip} style={{ ["--tilt" as string]: `${((t.slot * 37) % 7) - 3}deg`, ["--i" as string]: i }}>
            <span className={s.chipSlot}>{t.slot}</span>
            <span className={s.chipName} key={t.name}>
              {t.name}
            </span>
          </span>
        ))}
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- DESIGN */

function useSubmitPulse(teams: AdminTeamRow[]) {
  const prev = useRef<Map<number, string | null>>(new Map());
  const [pulses, setPulses] = useState<Record<number, number>>({});
  useEffect(() => {
    const fresh: number[] = [];
    for (const t of teams) {
      const before = prev.current.get(t.slot);
      if (prev.current.has(t.slot) && t.submittedGenerationId && before !== t.submittedGenerationId) fresh.push(t.slot);
      prev.current.set(t.slot, t.submittedGenerationId);
    }
    if (fresh.length) {
      setPulses((p) => {
        const n = { ...p };
        for (const slot of fresh) n[slot] = (n[slot] ?? 0) + 1;
        return n;
      });
    }
  }, [teams]);
  return pulses;
}

function Design({ state, offsetMs, timeUp }: { state: AdminState; offsetMs: number; timeUp: boolean }) {
  const pulses = useSubmitPulse(state.teams);
  const t = state.totals;
  return (
    <div className={s.phaseWrap}>
      <div className={s.phaseHead}>
        <div className={s.titleBlock}>
          <span className={s.kicker}>Round 1 · Design</span>
          <h1 className={cx(s.title, "split-text")}>Design your level</h1>
          <p className={s.sub}>Take the player from the start of the level to the exit.</p>
          <p className={s.showDontTell}>Show, don&apos;t tell!</p>
          <p className={s.sub}>
            Use all four: <b data-a="level">Level</b> <b data-a="enemy">Enemy</b> <b data-a="ability">Ability</b>{" "}
            <b data-a="puzzle">Puzzle</b>
          </p>
        </div>
        <div className={s.timerHuge}>
          <Timer endsAt={state.phaseEndsAt} pausedMs={state.timerPausedMs} serverOffsetMs={offsetMs} size="giant" warnAt={10} expiredLabel={null} />
          <span className={s.timerCap}>
            {timeUp ? "Time is up. Submit what you have!" : `${t.submissions} of ${t.teamsJoined} submitted`}
          </span>
        </div>
      </div>
      <TileGrid teams={state.teams}>
        {(team) => {
          const pill = activityPill(team.activity, "screen");
          return (
            <Tile key={team.slot} team={team} pulse={pulses[team.slot] ?? 0} submitted={!!team.submittedGenerationId}>
              {team.submittedGenerationId && team.activity === "submitted" ? (
                <span className={s.stamp}>Submitted</span>
              ) : (
                <StatusPill status={pill.status} label={pill.label} size="lg" />
              )}
              <span className={s.gens}>
                <b>{team.generationCount}</b> {team.generationCount === 1 ? "storyboard" : "storyboards"}
              </span>
            </Tile>
          );
        }}
      </TileGrid>
    </div>
  );
}

function TileGrid({ teams, children }: { teams: AdminTeamRow[]; children: (t: AdminTeamRow) => React.ReactNode }) {
  const n = teams.length;
  const cols = n <= 1 ? 1 : n <= 2 ? 2 : n <= 3 ? 3 : n <= 4 ? 4 : n <= 8 ? 4 : n <= 10 ? 5 : 6;
  if (n === 0) return <div className={s.noTeams}>No teams have joined yet.</div>;
  return (
    <div className={s.tiles} style={{ ["--cols" as string]: cols }} data-dense={n > 8 || undefined}>
      {teams.map(children)}
    </div>
  );
}

function Tile({ team, pulse, submitted, children }: { team: AdminTeamRow; pulse: number; submitted: boolean; children: React.ReactNode }) {
  return (
    <article className={cx(s.tile, submitted && s.tileDone)} key={pulse ? `p${pulse}` : undefined} data-pulse={pulse || undefined}>
      <Confetti fire={pulse || 0} pieces={60} origin="center" scope="parent" />
      <div className={s.tileHead}>
        <span className={s.tileSlot}>{team.slot}</span>
        <span className={s.tileName} key={team.name}>
          {team.name}
        </span>
      </div>
      <div className={s.tileBody}>{children}</div>
    </article>
  );
}

/* ---------------------------------------------------------------- VOTING */

function Voting({ state, offsetMs, timeUp }: { state: AdminState; offsetMs: number; timeUp: boolean }) {
  const t = state.totals;
  return (
    <div className={s.phaseWrap}>
      <div className={s.phaseHead}>
        <div className={s.titleBlock}>
          <span className={s.kicker}>Round 2 · Vote</span>
          <h1 className={cx(s.title, s.titleVote)}>
            Rate the <span className={s.hl}>design</span>,<br />
            not the art
          </h1>
          <p className={s.sub}>
            Score each design 1 to 5 on <b data-a="level">Level</b> <b data-a="enemy">Enemy</b> <b data-a="ability">Ability</b>{" "}
            <b data-a="puzzle">Puzzle</b>
          </p>
        </div>
        <div className={s.timerHuge}>
          <Timer endsAt={state.phaseEndsAt} pausedMs={state.timerPausedMs} serverOffsetMs={offsetMs} size="giant" warnAt={10} expiredLabel={null} />
          <span className={s.timerCap}>{timeUp ? "Time is up. Last ratings!" : `${t.votersDone} of ${t.teamsJoined} teams done`}</span>
        </div>
      </div>
      <TileGrid teams={state.teams}>
        {(team) => {
          const total = team.votesAssigned;
          const done = total > 0 && team.votesCast >= total;
          return (
            <Tile key={team.slot} team={team} pulse={0} submitted={false}>
              {total === 0 ? (
                <span className={s.gens}>Nothing to rate</span>
              ) : (
                <div className={s.voteRow}>
                  <div className={s.pips} aria-label={`rated ${team.votesCast} of ${total}`}>
                    {Array.from({ length: total }, (_, i) => (
                      <span key={i} className={cx(s.pip, i < team.votesCast && s.pipOn)} />
                    ))}
                  </div>
                  <span className={cx(s.voteNum, done && s.voteDone)}>
                    {done ? "Done" : `rated ${team.votesCast}/${total}`}
                  </span>
                </div>
              )}
            </Tile>
          );
        }}
      </TileGrid>
    </div>
  );
}

/* ---------------------------------------------------------------- REVEAL */

/** Width for the podium box so the (width-scaled) podium never runs off the bottom of the area. */
function useFitWidth(ratio: number) {
  const [el, ref] = useState<HTMLDivElement | null>(null);
  const [w, setW] = useState<number | null>(null);
  useEffect(() => {
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const cs = getComputedStyle(el);
      const innerW = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      setW(Math.max(200, Math.min(innerW, el.clientHeight * ratio)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [el, ratio]);
  return { ref, width: w };
}

function Reveal({ state }: { state: AdminState }) {
  const fit = useFitWidth(1.58);
  const rv = state.reveal;
  const [open, setOpen] = useState<number | null>(null);
  const shown = state.showcase ?? [];
  if (!rv || rv.maxStep === 0) {
    return (
      <div className={s.centerMsg}>
        <h1 className={cx(s.title, "split-text")}>The podium</h1>
        <p className={s.lockText}>No designs were rated this time.</p>
      </div>
    );
  }
  const offset = 3 - rv.maxStep;
  const podiumStep = (rv.step === 0 ? 0 : Math.min(3, rv.step + offset)) as 0 | 1 | 2 | 3;
  const entries: PodiumEntry[] = rv.revealed
    .filter((e) => e.rank >= 1 && e.rank <= 3)
    .map((e) => ({ place: e.rank as 1 | 2 | 3, name: e.name, imageUrl: e.imageUrl, score: e.score ?? NaN }));
  const winner = rv.step >= rv.maxStep ? rv.revealed.find((e) => e.rank === 1) : undefined;
  // Name the place just revealed (big), then tease the next one (small).
  const last = rv.step > 0 ? rv.revealed[rv.revealed.length - 1] : undefined;
  const nextPlace = rv.maxStep - rv.step;
  const teaser = winner || !last ? null : nextPlace === 1 ? "And the winner is..." : nextPlace === 2 ? "And in second place..." : null;
  return (
    <div className={s.reveal}>
      <div className={s.revealHead} key={rv.step}>
        {!last ? (
          <h1 className={cx(s.revealTitle, "split-text")}>Who designed the best level?</h1>
        ) : (
          <h1 className={cx(s.winnerLine, !winner && s.placeLine)}>
            <span className={s.winnerK}>{winner ? "Winner" : PLACE_LABEL[last.rank] ?? `Place ${last.rank}`}</span>
            <span className={s.winnerName}>
              {winner && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src="/art/trophy.png" alt="" className={s.trophyInline} aria-hidden />
              )}
              {last.name}
            </span>
          </h1>
        )}
        {teaser && <p className={s.revealedLine}>{teaser}</p>}
      </div>
      <div className={s.podiumArea} ref={fit.ref}>
        <div className={s.podiumBox} style={fit.width ? { width: fit.width } : undefined}>
          {/* The trophy and the winner's name live in the headline above, so the card shows only art + score. */}
          <Podium
            entries={entries}
            revealStep={podiumStep}
            trophy={false}
            hideWinnerName
            onSelect={(place) => {
              const e = rv.revealed.find((x) => x.rank === place);
              if (e && shown.some((x) => x.slot === e.slot)) setOpen(e.slot);
            }}
          />
        </div>
      </div>
      {open != null && shown.some((x) => x.slot === open) && (
        <Showcase entries={[...shown].sort((a, b) => (a.place ?? 9) - (b.place ?? 9))} slot={open} onChange={setOpen} onClose={() => setOpen(null)} />
      )}
    </div>
  );
}

const PLACE_LABEL: Record<number, string> = { 1: "1st place", 2: "2nd place", 3: "3rd place" };

/* ---------------------------------------------------------------- CLOSED */

function Closed({ state }: { state: AdminState }) {
  const subs = state.teams.filter((t) => t.submittedImageUrl);
  const placeOf = new Map<number, number>();
  for (const e of state.reveal?.revealed ?? []) if (e.rank <= 3) placeOf.set(e.slot, e.rank);
  const n = subs.length;
  const cols = n <= 1 ? 1 : n <= 4 ? 2 : n <= 6 ? 3 : n <= 8 ? 4 : n <= 10 ? 5 : 6;
  const rows = Math.max(1, Math.ceil(n / cols));
  // Storyboards are 3:2 and height-limited; size the gallery so the cards sit together instead of
  // spreading to the screen edges (about 0.82 of each row is image, the rest caption and gap).
  const fit = useFitWidth((cols * 1.5 * 0.82) / rows);
  const [open, setOpen] = useState<number | null>(null);
  const showcase = new Map((state.showcase ?? []).map((e) => [e.slot, e]));
  // Same order as the gallery, so the arrow keys walk the cards left to right.
  const ordered = subs.map((t) => showcase.get(t.slot)).filter((e): e is NonNullable<typeof e> => !!e);
  return (
    <div className={s.closed}>
      <div className={s.closedHead}>
        <span className={s.kicker}>Reflection</span>
        <h1 className={cx(s.title, "split-text")}>What did the AI get wrong?</h1>
        <p className={s.sub}>
          Look at your storyboard. What did it misunderstand? Was it your words or the AI? What would you write
          differently next time?
        </p>
      </div>
      {n === 0 ? (
        <p className={s.lockText}>No storyboards were submitted.</p>
      ) : (
        <div className={s.galleryArea} ref={fit.ref}>
        <div className={s.gallery} style={{ ["--cols" as string]: cols, ...(fit.width ? { width: fit.width } : {}) }}>
          {subs.map((t, i) => {
            const place = placeOf.get(t.slot);
            return (
              <figure key={t.slot} className={cx(s.card, place === 1 && s.cardWin)} style={{ ["--i" as string]: i }}>
                <div className={s.cardImg}>
                  <button
                    type="button"
                    className={cx(s.cardFit, s.cardBtn)}
                    onClick={() => showcase.has(t.slot) && setOpen(t.slot)}
                    disabled={!showcase.has(t.slot)}
                    aria-label={`Show ${t.name}'s design`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={t.submittedImageUrl!} alt={`Storyboard by ${t.name}`} />
                  </button>
                </div>
                <figcaption className={s.cardName}>
                  {place && <span className={cx(s.ribbon, s[`r${place}`])}>{place === 1 ? "Winner" : place === 2 ? "2nd" : "3rd"}</span>}
                  <span className={s.cardNameText}>{t.name}</span>
                </figcaption>
              </figure>
            );
          })}
        </div>
        </div>
      )}
      {n > 0 && ordered.length > 0 && <p className={s.galleryHint}>Click a storyboard to show it full screen</p>}
      {open != null && showcase.has(open) && <Showcase entries={ordered} slot={open} onChange={setOpen} onClose={() => setOpen(null)} />}
    </div>
  );
}
