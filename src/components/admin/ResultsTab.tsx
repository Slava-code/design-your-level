"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { SCORE_KEYS, type AdminState, type Scores } from "@/lib/types";
import s from "./admin.module.css";

const KEY_LABEL: Record<keyof Scores, string> = { level: "Level", enemy: "Enemy", ability: "Ability", puzzle: "Puzzle" };

export function ResultsTab({ state }: { state: AdminState }) {
  const [peek, setPeek] = useState(false);
  const ranking = state.ranking;
  const t = state.totals;

  if (state.phase !== "REVEAL" && state.phase !== "CLOSED") {
    const voting = state.phase === "VOTING";
    return (
      <div className={s.tabBody}>
        <div className={s.empty}>
          <p className={s.emptyBig}>{voting ? "Voting in progress" : "No results yet"}</p>
          <p className="muted">
            The full ranking is computed when you start Reveal. {voting && `${t.votesCast} of ${t.votesAssigned} ratings are in so far.`}
          </p>
        </div>
        {voting && (
          <div className={s.voteProgress}>
            {state.teams.map((team) => (
              <div key={team.slot} className={s.vpRow}>
                <span className={s.vpName}>{team.name}</span>
                <span className={s.vpBar}>
                  <span style={{ width: `${team.votesAssigned ? (team.votesCast / team.votesAssigned) * 100 : 0}%` }} />
                </span>
                <span className={s.vpNum}>
                  {team.votesCast}/{team.votesAssigned}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  const hidden = state.phase === "REVEAL" && !peek;
  return (
    <div className={s.tabBody}>
      <div className={s.feedBar}>
        <p className="muted">
          Score = mean of the four category means. Ties go to more ratings, then the earlier submission.
        </p>
        {state.phase === "REVEAL" && (
          <Button size="sm" variant={peek ? "ghost" : "secondary"} onClick={() => setPeek((v) => !v)}>
            {peek ? "Hide ranking" : "Show ranking (spoilers)"}
          </Button>
        )}
      </div>
      {hidden ? (
        <div className={s.empty}>
          <p className={s.emptyBig}>Ranking hidden</p>
          <p className="muted">Hidden so it does not leak if this tab is on screen. Press Show ranking to peek.</p>
        </div>
      ) : !ranking || ranking.length === 0 ? (
        <div className={s.empty}>
          <p className={s.emptyBig}>Nothing to rank</p>
          <p className="muted">No designs were submitted before voting started.</p>
        </div>
      ) : (
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead>
              <tr>
                <th scope="col" className={s.num}>
                  #
                </th>
                <th scope="col">Team</th>
                <th scope="col">Storyboard</th>
                <th scope="col" className={s.num}>
                  Score
                </th>
                {SCORE_KEYS.map((k) => (
                  <th key={k} scope="col" className={s.num}>
                    {KEY_LABEL[k]}
                  </th>
                ))}
                <th scope="col" className={s.num}>
                  Ratings
                </th>
              </tr>
            </thead>
            <tbody>
              {ranking.map((e) => (
                <tr key={e.slot} className={s.row} data-podium={e.rank <= 3 && e.score != null ? e.rank : undefined}>
                  <td className={s.num}>
                    <span className={s.rank}>{e.rank}</span>
                  </td>
                  <td>
                    <div className={s.teamNames}>
                      <span className={s.teamName}>{e.name}</span>
                      <span className={s.teamSub}>Team {e.slot}</span>
                    </div>
                  </td>
                  <td>
                    {e.imageUrl ? (
                      <a href={e.imageUrl} target="_blank" rel="noreferrer">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={e.imageUrl} alt={`Storyboard by ${e.name}`} className={s.thumb} />
                      </a>
                    ) : (
                      <span className={s.noThumb}>none</span>
                    )}
                  </td>
                  <td className={s.num}>
                    <span className={s.bigNum}>{e.score != null ? e.score.toFixed(2) : "--"}</span>
                  </td>
                  {SCORE_KEYS.map((k) => (
                    <td key={k} className={s.num}>
                      <span className={s.catCell} data-aspect={k}>
                        {e.categoryMeans ? e.categoryMeans[k].toFixed(2) : "--"}
                      </span>
                    </td>
                  ))}
                  <td className={s.num}>{e.ratings}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
