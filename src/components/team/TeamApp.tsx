"use client";

import { useEffect, useRef, useState } from "react";
import type { TeamState } from "@/lib/types";
import { useTeamState } from "./useTeamState";
import { JoinScreen } from "./JoinScreen";
import { NameStep } from "./NameStep";
import { TeamHeader } from "./TeamHeader";
import { LobbyScreen } from "./LobbyScreen";
import { DesignPhase } from "./DesignPhase";
import { VotingScreen } from "./VotingScreen";
import { RevealScreen, ClosedScreen } from "./RevealScreen";
import s from "./shell.module.css";

const onboardKey = (epoch: number, slot: number) => `dyl:onboarded:ev${epoch}:slot${slot}`;

function readFlag(key: string) {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

const PHASE_ANNOUNCE: Record<string, string> = {
  LOBBY: "Waiting for the host to start.",
  DESIGN: "Design time has started.",
  VOTING: "Voting has started.",
  REVEAL: "The reveal has started. Look at the big screen.",
  CLOSED: "The activity is over. Thanks for playing.",
};

/** Root of the team experience: join, then whatever phase the event is in. */
export function TeamApp() {
  const { state, serverOffsetMs, reconnecting, refresh } = useTeamState();
  const [expiredMsg, setExpiredMsg] = useState<string | null>(null);
  const lastTeam = useRef<{ epoch: number; slot: number } | null>(null);
  const [onboarded, setOnboarded] = useState<Record<string, boolean>>({});

  const team = state?.role === "team" ? (state as TeamState) : null;

  // Session expiry: we had a team, now we don't (event reset / epoch bump / cookie gone).
  useEffect(() => {
    if (!state) return;
    if (state.role === "team") {
      lastTeam.current = { epoch: state.epoch, slot: (state as TeamState).team.slot };
      setExpiredMsg(null);
    } else if (state.role === "anon") {
      if (lastTeam.current || state.sessionExpired) {
        setExpiredMsg(
          lastTeam.current && lastTeam.current.epoch !== state.epoch
            ? "The event was reset, so everyone was signed out. Join again with your team code."
            : "Your session ended. Join again with your team code.",
        );
        lastTeam.current = null;
      }
    }
  }, [state]);

  // Phase change announcements for screen readers.
  const [announce, setAnnounce] = useState("");
  const lastPhase = useRef<string | null>(null);
  useEffect(() => {
    if (!team) return;
    if (lastPhase.current && lastPhase.current !== team.phase) {
      setAnnounce(PHASE_ANNOUNCE[team.phase] ?? "");
      // A new phase is a new screen: start it at the top (the design form leaves the page scrolled far down).
      window.scrollTo({ top: 0, behavior: "instant" });
    }
    lastPhase.current = team.phase;
  }, [team]);

  if (!state) {
    return (
      <main className={s.boot} aria-busy="true">
        <div className={s.bootInner}>
          <span className={s.bootText}>
            LOADING<span className="anim-blink">_</span>
          </span>
        </div>
      </main>
    );
  }

  if (!team) {
    return (
      <>
        <JoinScreen
          message={expiredMsg}
          onJoined={async () => {
            setExpiredMsg(null);
            await refresh();
          }}
        />
        {reconnecting && <Reconnecting />}
      </>
    );
  }

  const key = onboardKey(team.epoch, team.team.slot);
  const isOnboarded = onboarded[key] ?? readFlag(key);
  const needsName = !isOnboarded && team.canRename;

  const finishOnboarding = () => {
    try {
      window.localStorage.setItem(key, "1");
    } catch {
      /* ignore */
    }
    setOnboarded((o) => ({ ...o, [key]: true }));
  };

  return (
    <div className={s.app} data-phase={team.phase}>
      <div className="sr-only" aria-live="polite" role="status">
        {announce}
      </div>
      {needsName ? (
        <NameStep state={team} onDone={finishOnboarding} refresh={refresh} />
      ) : (
        <>
          <TeamHeader state={team} serverOffsetMs={serverOffsetMs} refresh={refresh} />
          <PhaseBody state={team} serverOffsetMs={serverOffsetMs} refresh={refresh} />
        </>
      )}
      {reconnecting && <Reconnecting />}
    </div>
  );
}

function PhaseBody({ state, serverOffsetMs, refresh }: { state: TeamState; serverOffsetMs: number; refresh: () => Promise<void> }) {
  switch (state.phase) {
    case "LOBBY":
      return <LobbyScreen state={state} />;
    case "DESIGN":
      return <DesignPhase key={`${state.epoch}:${state.team.slot}`} state={state} serverOffsetMs={serverOffsetMs} refresh={refresh} />;
    case "VOTING":
      return <VotingScreen key={`${state.epoch}:${state.team.slot}`} state={state} refresh={refresh} />;
    case "REVEAL":
      return <RevealScreen state={state} />;
    case "CLOSED":
      return <ClosedScreen state={state} />;
    default:
      return null;
  }
}

function Reconnecting() {
  return (
    <div className={s.reconnecting} role="status" aria-live="polite">
      <span className={s.reconDot} aria-hidden />
      Reconnecting
    </div>
  );
}
