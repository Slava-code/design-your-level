"use client";

import { useEffect, useRef, useState } from "react";
import type { Phase, RenameResponse, TeamState } from "@/lib/types";
import { BudgetMeter, ConfirmDialog, Timer, useToast, cx } from "@/components/ui";
import { post } from "./api";
import s from "./shell.module.css";

const PHASE_LABEL: Record<Phase, string> = {
  LOBBY: "Lobby",
  DESIGN: "Design time",
  VOTING: "Voting",
  REVEAL: "Reveal",
  CLOSED: "Finished",
};

type Props = { state: TeamState; serverOffsetMs: number; refresh: () => Promise<void>; onLogout: () => Promise<void> };

/** Sticky top bar: team name (editable), phase + timer, budget during DESIGN. */
export function TeamHeader({ state, serverOffsetMs, refresh, onLogout }: Props) {
  const { team, phase, phaseEndsAt, timerPausedMs, canRename } = state;
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(team.name);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const [confirmOut, setConfirmOut] = useState(false);
  const [leaving, setLeaving] = useState(false);

  async function logout() {
    setLeaving(true);
    const r = await post("/api/leave");
    if (!r.ok) {
      setLeaving(false);
      toast.error(r.error.error);
      return;
    }
    await onLogout();
  }

  useEffect(() => {
    if (!editing) setName(team.name);
  }, [team.name, editing]);
  useEffect(() => {
    if (!canRename) setEditing(false);
  }, [canRename]);
  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  async function save(e?: React.FormEvent) {
    e?.preventDefault();
    const clean = name.replace(/\s+/g, " ").trim();
    if (!clean || clean === team.name) {
      setEditing(false);
      setName(team.name);
      return;
    }
    setBusy(true);
    const r = await post<RenameResponse>("/api/team/name", { name: clean });
    setBusy(false);
    if (!r.ok) {
      toast.error(r.error.error);
      return;
    }
    setEditing(false);
    toast.success(`You're now "${r.data.team.name}".`);
    await refresh();
  }

  const perGen = state.estimates.generateUsd;

  return (
    <header className={s.header}>
      <div className={s.headerRow}>
        <div className={s.teamBlock}>
          <span className={s.teamSlot}>Team {team.slot}</span>
          {editing ? (
            <form className={s.renameForm} onSubmit={save}>
              <label htmlFor="rename" className="sr-only">
                Team name
              </label>
              <input
                id="rename"
                ref={inputRef}
                className={s.renameInput}
                value={name}
                maxLength={32}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setEditing(false);
                    setName(team.name);
                  }
                }}
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="done"
                disabled={busy}
              />
              <button type="submit" className={s.renameSave} disabled={busy}>
                {busy ? "..." : "Save"}
              </button>
            </form>
          ) : canRename ? (
            <button type="button" className={s.teamName} onClick={() => setEditing(true)} aria-label={`Team name: ${team.name}. Tap to rename`}>
              <span className={s.teamNameText}>{team.name}</span>
              <svg className={s.pencil} viewBox="0 0 24 24" aria-hidden width="18" height="18">
                <path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
              </svg>
            </button>
          ) : (
            <span className={s.teamName} data-static>
              <span className={s.teamNameText}>{team.name}</span>
            </span>
          )}
        </div>
        <div className={s.phaseBlock}>
          <span className={s.phaseLabel}>{PHASE_LABEL[phase]}</span>
          {phaseEndsAt || timerPausedMs != null ? (
            <Timer endsAt={phaseEndsAt} pausedMs={timerPausedMs} serverOffsetMs={serverOffsetMs} size="md" className={s.timer} />
          ) : (
            <span className={cx(s.phaseDot, phase === "DESIGN" || phase === "VOTING" ? s.live : null)} aria-hidden />
          )}
          <button type="button" className={s.logout} onClick={() => setConfirmOut(true)}>
            Log out
          </button>
        </div>
      </div>
      {phase === "DESIGN" && (
        <div className={s.budgetRow}>
          <BudgetMeter
            spentUsd={team.spendUsd}
            budgetUsd={team.budgetUsd}
            unit="credits"
            perGenerationUsd={perGen}
            compact
            label="Team credits"
          />
        </div>
      )}
      <ConfirmDialog
        open={confirmOut}
        title={`Log out of Team ${team.slot}?`}
        body={
          <p>
            Nothing is lost: {team.name}&apos;s storyboards and credits stay saved, and teammates on other devices stay logged in. You can join again
            (or join a different team) with a team code.
          </p>
        }
        confirmLabel="Log out"
        busy={leaving}
        onConfirm={logout}
        onCancel={() => setConfirmOut(false)}
      />
    </header>
  );
}
