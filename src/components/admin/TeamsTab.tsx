"use client";

import { useState } from "react";
import { BudgetMeter, Button, ConfirmDialog, StatusPill, useToast } from "@/components/ui";
import type { AdminState, AdminTeamRow, ResetBudgetResponse } from "@/lib/types";
import { activityPill, ago, api, clock, usd } from "./lib";
import { TeamDrawer } from "./TeamDrawer";
import { toCredits } from "@/lib/credits";
import s from "./admin.module.css";

export function TeamsTab({ state, now, refresh }: { state: AdminState; now: number; refresh: () => void }) {
  const toast = useToast();
  const [viewSlot, setViewSlot] = useState<number | null>(null);
  const [resetFor, setResetFor] = useState<AdminTeamRow | null>(null);
  const [busy, setBusy] = useState(false);
  const voting = state.phase === "VOTING" || state.phase === "REVEAL" || state.phase === "CLOSED";
  const t = state.totals;

  async function doReset() {
    if (!resetFor) return;
    setBusy(true);
    const r = await api<ResetBudgetResponse>(`/api/admin/team/${resetFor.slot}/reset-budget`, {});
    setBusy(false);
    if (r.ok) {
      toast.success(`${resetFor.name}: spend back to $0.00. Their work is kept.`, { title: "Budget reset" });
      setResetFor(null);
      refresh();
    } else toast.error(r.error, { title: "Could not reset credits" });
  }

  return (
    <div className={s.tabBody}>
      <div className={s.statRow}>
        <Stat label="Teams joined" value={`${t.teamsJoined}`} sub={`of ${state.slotsConfigured} code cards`} />
        <Stat label="Online now" value={`${state.teams.filter((x) => x.online).length}`} sub="polled in the last 15 s" />
        <Stat label="Submitted" value={`${t.submissions}`} sub={`of ${t.teamsJoined} teams`} tone={t.submissions && t.submissions >= t.teamsJoined ? "good" : undefined} />
        <Stat label="Storyboards" value={`${t.generationsDone}`} sub={t.inFlight ? `${t.inFlight} in flight now` : "none in flight"} />
        <Stat label="Team spend" value={usd(t.totalSpendUsd)} sub={t.totalReservedUsd > 0 ? `+ ${usd(t.totalReservedUsd)} reserved` : "nothing reserved"} />
        {voting && <Stat label="Votes" value={`${t.votesCast}/${t.votesAssigned}`} sub={`${t.votersDone} teams done`} />}
      </div>

      {state.teams.length === 0 ? (
        <div className={s.empty}>
          <p className={s.emptyBig}>No teams yet</p>
          <p className="muted">
            Teams appear here the moment they join with a code card. {state.slotsConfigured} slots are configured.
          </p>
        </div>
      ) : (
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead>
              <tr>
                <th scope="col">Team</th>
                <th scope="col">Activity</th>
                <th scope="col">Seen</th>
                <th scope="col" className={s.budgetCol}>
                  Credits used
                </th>
                <th scope="col" className={s.num}>
                  Gens
                </th>
                {voting && (
                  <th scope="col" className={s.num}>
                    Rated
                  </th>
                )}
                <th scope="col">Submitted</th>
                <th scope="col" className={s.actionsCol}>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {state.teams.map((team) => {
                const pill = activityPill(team.activity);
                return (
                  <tr key={team.slot} className={s.row}>
                    <td>
                      <div className={s.teamCell}>
                        <span className={s.slot}>{team.slot}</span>
                        <span className={s.teamNames}>
                          <span className={s.teamName}>{team.name}</span>
                          <span className={s.teamSub}>
                            Team {team.slot} · joined {clock(team.joinedAt)}
                          </span>
                        </span>
                      </div>
                    </td>
                    <td>
                      <StatusPill status={pill.status} label={pill.label} size="sm" />
                    </td>
                    <td>
                      <span className={s.seen}>
                        <span className={team.online ? s.dotOn : s.dotOff} aria-hidden />
                        <span>{team.online ? "online" : ago(team.lastSeenAt, now)}</span>
                      </span>
                    </td>
                    <td className={s.budgetCol}>
                      <BudgetMeter compact unit="credits" spentUsd={team.spendUsd} budgetUsd={team.budgetUsd} reservedUsd={team.reservedUsd} />
                    </td>
                    <td className={s.num}>
                      <span className={s.bigNum}>{team.generationCount}</span>
                    </td>
                    {voting && (
                      <td className={s.num}>
                        <span className={s.bigNum}>
                          {team.votesCast}
                          <span className="muted">/{team.votesAssigned}</span>
                        </span>
                      </td>
                    )}
                    <td>
                      {team.submittedImageUrl ? (
                        <button type="button" className={s.thumbBtn} onClick={() => setViewSlot(team.slot)} title="View this team">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={team.submittedImageUrl} alt={`Submitted storyboard by ${team.name}`} className={s.thumb} />
                        </button>
                      ) : (
                        <span className={s.noThumb}>not yet</span>
                      )}
                    </td>
                    <td className={s.actionsCol}>
                      <div className={s.rowActions}>
                        <Button size="sm" variant="secondary" onClick={() => setViewSlot(team.slot)}>
                          View
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setResetFor(team)} disabled={team.spendUsd <= 0 && team.reservedUsd <= 0}>
                          Reset credits
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <TeamDrawer
        slot={viewSlot}
        row={state.teams.find((x) => x.slot === viewSlot) ?? null}
        onClose={() => setViewSlot(null)}
        onResetBudget={(row) => setResetFor(row)}
      />

      <ConfirmDialog
        open={!!resetFor}
        title={resetFor ? `Reset ${resetFor.name}'s credits?` : "Reset credits?"}
        body={
          resetFor && (
            <p>
              Gives them the full {toCredits(resetFor.budgetUsd)} credits again. Their generations and submission are kept.
              They have used {toCredits(resetFor.spendUsd)} credits ({usd(resetFor.spendUsd, 3)} of real OpenAI cost), which still counts toward the $50 project cap.
            </p>
          )
        }
        confirmLabel="Reset credits"
        busy={busy}
        onConfirm={doReset}
        onCancel={() => setResetFor(null)}
      />
    </div>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "good" | "warn" }) {
  return (
    <div className={s.stat} data-tone={tone}>
      <span className={s.statLabel}>{label}</span>
      <span className={s.statValue}>{value}</span>
      {sub && <span className={s.statSub}>{sub}</span>}
    </div>
  );
}
