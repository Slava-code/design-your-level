"use client";

import { useEffect, useState } from "react";
import { Button, ConfirmDialog, Panel, Timer, useToast } from "@/components/ui";
import {
  PHASES,
  type AdminState,
  type Phase,
  type PhaseResponse,
  type ResetEventResponse,
  type RevealResponse,
  type TimerResponse,
} from "@/lib/types";
import { DEFAULT_DURATION, PHASE_HINT, PHASE_LABEL, api, mmss, parseDuration, usd } from "./lib";
import { openProjector } from "./openProjector";
import s from "./admin.module.css";

type Pending = { to: Phase; durationSec: number; title: string; body: React.ReactNode; danger?: boolean } | null;

const PLACE_WORD: Record<number, string> = { 1: "the winner", 2: "2nd place", 3: "3rd place" };

/** Label of the button that moves INTO each phase. */
const CTA: Record<Phase, string> = {
  LOBBY: "Back to the lobby",
  DESIGN: "Start designing",
  VOTING: "Start voting",
  REVEAL: "Go to the podium",
  CLOSED: "End and show the gallery",
};

/** Next podium step, shared by the Phase panel (big button) and the Reveal panel (undo / hide). */
function useRevealAction(state: AdminState, refresh: () => void) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function act(action: "next" | "prev" | "reset") {
    setBusy(true);
    // fromStep: a double click (or a second admin tab) can't skip a place.
    const r = await api<RevealResponse>("/api/admin/reveal", { action, fromStep: state.reveal?.step ?? 0 });
    setBusy(false);
    if (!r.ok) toast.error(r.error, { title: "Reveal" });
    refresh();
  }
  return { busy, act };
}

export function ControlsTab({ state, offsetMs, refresh }: { state: AdminState; offsetMs: number; refresh: () => void }) {
  // The panel you need right now goes top-right, above the fold: Timer while teams work, Reveal during the podium.
  const revealing = state.phase === "REVEAL";
  const timer = <TimerPanel state={state} offsetMs={offsetMs} refresh={refresh} />;
  const reveal = <RevealPanel state={state} refresh={refresh} />;
  return (
    <div className={s.controlsGrid}>
      <div className={s.controlsCol}>
        <PhasePanel state={state} refresh={refresh} />
        {revealing ? timer : reveal}
      </div>
      <div className={s.controlsCol}>
        {revealing ? reveal : timer}
        <SpendPanel state={state} />
        <Panel variant="plain" kicker="Projector" title="Big screen" pad="md" titleAs="h3">
          <p className={s.panelText}>
            Opens <span className="vt">/screen</span> in a new tab. Share that tab (or drag it to the projector). It uses this browser&apos;s
            admin login and never shows codes.
          </p>
          <Button size="lg" variant="secondary" block onClick={openProjector}>
            Open projector screen
          </Button>
        </Panel>
        <DangerPanel refresh={refresh} />
      </div>
    </div>
  );
}

function PhasePanel({ state, refresh }: { state: AdminState; refresh: () => void }) {
  const toast = useToast();
  const idx = PHASES.indexOf(state.phase);
  const next = PHASES[idx + 1] as Phase | undefined;
  const prev = PHASES[idx - 1] as Phase | undefined;
  const [dur, setDur] = useState<string>(() => (next && DEFAULT_DURATION[next] ? mmss(DEFAULT_DURATION[next]) : ""));
  const [busy, setBusy] = useState<Phase | null>(null);
  const [pending, setPending] = useState<Pending>(null);

  // Reset the duration box to the next phase's default whenever the phase changes.
  useEffect(() => {
    setDur(next && DEFAULT_DURATION[next] ? mmss(DEFAULT_DURATION[next]) : "");
  }, [next]);

  const timedNext = next === "DESIGN" || next === "VOTING";
  const parsedRaw = dur.trim() ? parseDuration(dur) : 0;
  const parsed = timedNext ? parsedRaw : 0;
  const durOk = !timedNext || (parsedRaw !== null && parsedRaw <= 4 * 3600);
  const t = state.totals;
  const rv = state.reveal;
  const reveal = useRevealAction(state, refresh);
  // During the podium the next podium step is THE action; ending the reveal is demoted to a small button.
  const podiumLeft = state.phase === "REVEAL" && !!rv && rv.maxStep > 0 && rv.step < rv.maxStep;
  const nextPlace = rv ? rv.maxStep - rv.step : 0;

  async function go(to: Phase, durationSec: number) {
    setBusy(to);
    const r = await api<PhaseResponse>("/api/admin/phase", { phase: to, durationSec });
    setBusy(null);
    setPending(null);
    if (!r.ok) {
      toast.error(r.error, { title: "Phase not changed" });
      return;
    }
    toast.success(`Now in ${PHASE_LABEL[r.data.phase]}${durationSec ? ` with a ${mmss(durationSec)} timer` : ""}.`, { title: "Phase changed" });
    if (r.data.warning) toast.show(r.data.warning, { tone: "warn", title: "Heads up", durationMs: 9000 });
    refresh();
  }

  function advance() {
    if (!next || !durOk) return;
    const d = parsed ?? 0;
    if (state.phase === "DESIGN" && next === "VOTING") {
      const missing = t.teamsJoined - t.submissions;
      if (missing > 0 || t.inFlight > 0) {
        setPending({
          to: next,
          durationSec: d,
          title: "Start voting now?",
          body: (
            <>
              {missing > 0 && (
                <p>
                  {missing} of {t.teamsJoined} teams {missing === 1 ? "has" : "have"} not submitted. Their designs will not be rated.
                </p>
              )}
              {t.inFlight > 0 && <p>{t.inFlight} generation(s) are still running; they can no longer be submitted.</p>}
              <p>Submissions freeze and each team gets up to 4 designs to rate.</p>
            </>
          ),
        });
        return;
      }
    }
    if (state.phase === "REVEAL" && next === "CLOSED" && rv && rv.step < rv.maxStep) {
      setPending({
        to: next,
        durationSec: d,
        title: "Skip the podium?",
        body: (
          <p>
            Only {rv.step} of {rv.maxStep} places are on screen. The winner hasn&apos;t been revealed yet.
          </p>
        ),
        danger: true,
      });
      return;
    }
    if (state.phase === "VOTING" && next === "REVEAL" && t.votesAssigned > 0 && t.votesCast < t.votesAssigned) {
      setPending({
        to: next,
        durationSec: d,
        title: "Close voting and rank?",
        body: (
          <p>
            {t.votesCast} of {t.votesAssigned} ratings are in ({t.votersDone} of {t.teamsJoined} teams finished). Missing ratings just do not count.
          </p>
        ),
      });
      return;
    }
    void go(next, d);
  }

  function back() {
    if (!prev) return;
    const notes: Partial<Record<Phase, string>> = {
      LOBBY: "Teams keep their names and work; generating and uploads stop until Design starts again.",
      DESIGN: "Voting stops. Teams can edit and resubmit. When you start voting again, assignments are recomputed and votes for changed submissions are dropped.",
      VOTING: "The projector leaves the podium. Votes are kept; the ranking is recomputed when you reveal again.",
      REVEAL: "Back to the podium.",
    };
    setPending({
      to: prev,
      durationSec: 0,
      title: `Go back to ${PHASE_LABEL[prev]}?`,
      body: <p>{notes[prev]} The timer is cleared; set a new one in the Timer panel if needed.</p>,
      danger: true,
    });
  }

  return (
    <Panel variant="terminal" kicker="Phase" title={PHASE_LABEL[state.phase]} pad="md" titleAs="h3" className={s.phasePanel}>
      <ol className={s.stepper} aria-label="Phases">
        {PHASES.map((p, i) => (
          <li key={p} className={s.step} data-state={i < idx ? "done" : i === idx ? "current" : "todo"} aria-current={i === idx ? "step" : undefined}>
            <span className={s.stepDot}>{i + 1}</span>
            <span className={s.stepLabel}>{PHASE_LABEL[p]}</span>
          </li>
        ))}
      </ol>
      <p className={s.panelText}>{PHASE_HINT[state.phase]}</p>

      {next && podiumLeft ? (
        <div className={s.nextBox}>
          <div className={s.nextHead}>
            <span className={s.nextKicker}>Next</span>
            <span className={s.nextName}>Podium step {rv!.step + 1} of {rv!.maxStep}</span>
          </div>
          <p className={s.nextHint}>Each click puts the next place on the projector. The winner comes last.</p>
          <Button size="xl" block onClick={() => reveal.act("next")} loading={reveal.busy} disabled={reveal.busy || !!busy}>
            {`Reveal ${PLACE_WORD[nextPlace] ?? `place ${nextPlace}`}`}
          </Button>
          <div className={s.endRow}>
            <Button variant="ghost" size="sm" onClick={advance} loading={busy === next} disabled={!!busy || reveal.busy}>
              {CTA[next]}
            </Button>
          </div>
        </div>
      ) : next ? (
        <div className={s.nextBox}>
          <div className={s.nextHead}>
            <span className={s.nextKicker}>Next</span>
            <span className={s.nextName}>{PHASE_LABEL[next]}</span>
          </div>
          <p className={s.nextHint}>{PHASE_HINT[next]}</p>
          <div className={s.nextRow}>
            {timedNext && (
            <label className={s.durLabel}>
              <span>{PHASE_LABEL[next]} length</span>
              <input
                className={s.durInput}
                value={dur}
                onChange={(e) => setDur(e.target.value)}
                placeholder="none"
                inputMode="text"
                aria-invalid={!durOk || undefined}
                aria-describedby="dur-hint"
              />
            </label>
            )}
            <Button size="xl" onClick={advance} loading={busy === next} disabled={!durOk || !!busy} className={s.goBtn}>
              {CTA[next]}
            </Button>
          </div>
          {timedNext && (
            <span id="dur-hint" className={s.durHint}>
              {durOk
                ? parsed
                  ? `A ${mmss(parsed)} countdown starts on every screen when you press ${CTA[next]}.`
                  : "No countdown (leave empty)."
                : "Use m:ss, e.g. 15:00 or 4:30"}
            </span>
          )}
        </div>
      ) : (
        <p className={s.panelText}>This is the last phase. Use Reset event (below right) after testing to start fresh.</p>
      )}

      {prev && (
        <div className={s.backRow}>
          <Button variant="ghost" size="sm" onClick={back} disabled={!!busy}>
            Back to {PHASE_LABEL[prev]}
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={!!pending}
        title={pending?.title ?? ""}
        body={pending?.body}
        confirmLabel={pending ? (PHASES.indexOf(pending.to) < idx ? `Back to ${PHASE_LABEL[pending.to]}` : CTA[pending.to]) : "OK"}
        danger={pending?.danger}
        busy={!!busy}
        onConfirm={() => pending && go(pending.to, pending.durationSec)}
        onCancel={() => setPending(null)}
      />
    </Panel>
  );
}

function TimerPanel({ state, offsetMs, refresh }: { state: AdminState; offsetMs: number; refresh: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [setVal, setSetVal] = useState("");
  const [confirmEnd, setConfirmEnd] = useState(false);

  const paused = state.timerPausedMs != null && !state.phaseEndsAt;
  const running = !!state.phaseEndsAt && Date.parse(state.phaseEndsAt) - (Date.now() + offsetMs) > 0;
  const hasTimer = running || paused;
  const timed = state.phase === "DESIGN" || state.phase === "VOTING";

  async function send(body: { addSec?: number; setSec?: number; action?: "pause" | "resume" | "end" }) {
    setBusy(true);
    const r = await api<TimerResponse>("/api/admin/timer", body);
    setBusy(false);
    if (!r.ok) toast.error(r.error, { title: "Timer not changed" });
    refresh();
  }

  const parsed = parseDuration(setVal);
  const title = timed ? `${PHASE_LABEL[state.phase]} timer` : "Timer";
  return (
    <Panel variant="terminal" kicker="Running now" title={title} pad="md" titleAs="h3">
      <div className={s.timerLayout}>
        <div className={s.timerBig}>
          <Timer
            endsAt={state.phaseEndsAt}
            pausedMs={state.timerPausedMs}
            serverOffsetMs={offsetMs}
            size="lg"
            label={state.phaseEndsAt ? "left" : "No timer"}
          />
        </div>
        <div className={s.timerControls}>
          {hasTimer ? (
            <>
              <div className={s.timerBtns}>
                <Button variant="primary" onClick={() => send({ action: paused ? "resume" : "pause" })} disabled={busy}>
                  {paused ? "Resume" : "Pause"}
                </Button>
                <Button variant="danger" onClick={() => setConfirmEnd(true)} disabled={busy}>
                  End now
                </Button>
              </div>
              <div className={s.timerBtns}>
                <Button variant="secondary" onClick={() => send({ addSec: -60 })} disabled={busy}>
                  -1:00
                </Button>
                <Button variant="secondary" onClick={() => send({ addSec: 60 })} disabled={busy}>
                  +1:00
                </Button>
                <Button variant="secondary" onClick={() => send({ addSec: 120 })} disabled={busy}>
                  +2:00
                </Button>
                <Button variant="secondary" onClick={() => send({ addSec: 300 })} disabled={busy}>
                  +5:00
                </Button>
              </div>
            </>
          ) : null}
          <form
            className={s.timerSet}
            onSubmit={(e) => {
              e.preventDefault();
              if (parsed && parsed > 0) {
                void send({ setSec: parsed });
                setSetVal("");
              }
            }}
          >
            <label className={s.durLabel}>
              <span>{hasTimer ? "Change to" : "Start a countdown"}</span>
              <input className={s.durInput} value={setVal} onChange={(e) => setSetVal(e.target.value)} placeholder={hasTimer ? "5:00" : "15:00"} aria-label="Countdown length (m:ss)" />
            </label>
            <Button type="submit" variant={hasTimer ? "ghost" : "primary"} disabled={busy || !parsed || parsed <= 0}>
              {hasTimer ? "Set" : "Start"}
            </Button>
            {hasTimer && (
              <Button variant="ghost" onClick={() => send({ setSec: 0 })} disabled={busy}>
                Remove
              </Button>
            )}
          </form>
        </div>
      </div>
      <p className={s.durHint}>
        This changes the countdown that is running now. It is only a display: the phase moves on when you press the big phase button.
      </p>
      <ConfirmDialog
        open={confirmEnd}
        title="End the countdown now?"
        body={
          <p>
            Every screen jumps to 0:00 and shows that time is up. The phase does not change: press{" "}
            {state.phase === "DESIGN" ? "Start voting" : state.phase === "VOTING" ? "Go to the podium" : "the phase button"} when you are ready to move on.
          </p>
        }
        confirmLabel="End now"
        danger
        busy={busy}
        onConfirm={() => {
          setConfirmEnd(false);
          void send({ action: "end" });
        }}
        onCancel={() => setConfirmEnd(false)}
      />
    </Panel>
  );
}

function RevealPanel({ state, refresh }: { state: AdminState; refresh: () => void }) {
  const { busy, act } = useRevealAction(state, refresh);
  const rv = state.reveal;

  if (state.phase !== "REVEAL" || !rv) {
    return (
      <Panel variant="plain" kicker="Reveal" title="Podium" pad="md" titleAs="h3">
        <p className={s.panelText}>
          {state.phase === "CLOSED"
            ? "The reveal is over. Go back to Reveal if you need the podium on screen again."
            : "Reveal controls appear when you go to the podium. Then each click on the big button shows the next place on the projector: 3rd, 2nd, then the winner."}
        </p>
      </Panel>
    );
  }

  const done = rv.step >= rv.maxStep;
  return (
    <Panel variant="parchment" kicker="Reveal" title="Podium" pad="lg" titleAs="h3" className={s.revealPanel}>
      {rv.maxStep === 0 ? (
        <p className={s.panelText}>No designs were rated, so there is nothing to put on the podium.</p>
      ) : (
        <>
          <p className={s.revealStep}>
            {done ? "The winner is on screen" : rv.step === 0 ? "Nothing revealed yet" : `${rv.step} of ${rv.maxStep} places on screen`}
          </p>
          <p className={s.panelText}>{done ? "When you're done, end the reveal to show every storyboard." : "Use the big Reveal button on the left."}</p>
          <ol className={s.revealed}>
            {rv.revealed
              .slice()
              .sort((a, b) => a.rank - b.rank)
              .map((e) => (
                <li key={e.slot}>
                  <span className={s.revPlace}>{e.rank}</span>
                  <span className={s.revName}>{e.name}</span>
                  <span className={s.revScore}>{e.score != null ? e.score.toFixed(2) : "--"}</span>
                </li>
              ))}
          </ol>
          <div className={s.revealSmall}>
            <Button variant="ghost" size="sm" onClick={() => act("prev")} disabled={busy || rv.step === 0}>
              Undo one step
            </Button>
            <Button variant="ghost" size="sm" onClick={() => act("reset")} disabled={busy || rv.step === 0}>
              Hide all
            </Button>
          </div>
          <p className={s.durHint}>The projector follows within about 2 seconds of each click.</p>
        </>
      )}
    </Panel>
  );
}

function SpendPanel({ state }: { state: AdminState }) {
  const t = state.totals;
  return (
    <Panel variant="plain" kicker="Money" title="OpenAI spend" pad="md" titleAs="h3">
      <div className={s.spendRow}>
        <span className={s.spendBig}>{usd(t.totalSpendUsd)}</span>
        <span className={s.spendSub}>
          spent by all teams this event
          {t.totalReservedUsd > 0 && <> · {usd(t.totalReservedUsd)} reserved for calls running now</>}
        </span>
      </div>
      <p className={s.panelText}>
        The OpenAI project has a hard cap of <strong>$50 per month</strong>, and November test runs count toward it. If it is hit, calls fail
        and teams see &quot;The class AI budget has run out&quot;. Each team&apos;s own limit is shown on the Teams tab.
      </p>
      <p className={s.durHint}>
        {t.generationsDone} storyboards done · {t.inFlight} running now
      </p>
    </Panel>
  );
}

function DangerPanel({ refresh }: { refresh: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function reset() {
    setBusy(true);
    const r = await api<ResetEventResponse>("/api/admin/reset-event", { confirm: "RESET" });
    setBusy(false);
    if (!r.ok) {
      toast.error(r.error, { title: "Reset failed" });
      return;
    }
    setOpen(false);
    toast.success(`Everything wiped, ${r.data.blobsDeleted} uploaded file(s) deleted. All teams are logged out.`, { title: "Event reset" });
    refresh();
  }

  return (
    <Panel variant="plain" kicker="Danger zone" title="Reset event" pad="md" titleAs="h3" className={s.danger}>
      <p className={s.panelText}>
        For after testing, before class. Wipes all teams, generations, uploads, votes and spend, goes back to Lobby and logs every team out.
        You stay logged in. Printed code cards keep working.
      </p>
      <Button variant="danger" onClick={() => setOpen(true)}>
        Reset event
      </Button>
      <ConfirmDialog
        open={open}
        danger
        title="Wipe the whole event?"
        body={
          <p>
            This deletes every team, generation, uploaded image, vote and all spend, and logs every team out. It cannot be undone.
          </p>
        }
        requireText="RESET"
        confirmLabel="Wipe everything"
        busy={busy}
        onConfirm={reset}
        onCancel={() => setOpen(false)}
      />
    </Panel>
  );
}
