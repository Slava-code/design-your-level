"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Panel } from "@/components/ui";
import type { GameDetailResponse, GameSummary, GamesResponse } from "@/lib/types";
import { api, usd } from "./lib";
import s from "./games.module.css";

const PLACE: Record<number, string> = { 1: "1st", 2: "2nd", 3: "3rd" };

function when(isoDate: string | null) {
  if (!isoDate) return "";
  const d = new Date(isoDate);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** Past games: every finished game is kept with all its teams, storyboards, prompts, votes and log. */
export function GamesTab({ currentEpoch }: { currentEpoch: number }) {
  const [games, setGames] = useState<GameSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [detail, setDetail] = useState<GameDetailResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    const r = await api<GamesResponse>("/api/admin/games");
    if (r.ok) {
      setGames(r.data.games);
      setError(null);
    } else setError(r.error);
  }, []);

  useEffect(() => {
    void load();
  }, [load, currentEpoch]);

  async function open(id: number) {
    setOpenId(id);
    setDetail(null);
    setLoading(true);
    const r = await api<GameDetailResponse>(`/api/admin/games/${id}`);
    setLoading(false);
    if (r.ok) setDetail(r.data);
    else setError(r.error);
  }

  // Empty test games (nobody joined) are hidden from the list, except the live one.
  const shown = (games ?? []).filter((g) => g.current || g.teams > 0);
  const hiddenEmpty = (games ?? []).length - shown.length;

  return (
    <div className={s.wrap}>
      <Panel variant="terminal" kicker="Game sessions" title="Past games" pad="md" titleAs="h3">
        <p className={s.lead}>
          Every game is kept. &quot;Start new game&quot; (Controls tab) saves the current one here with all its teams, storyboards, prompts,
          votes and log, and none of its images are deleted.
        </p>
        {error && <p className={s.error}>{error}</p>}
        {!games ? (
          <p className={s.muted}>Loading...</p>
        ) : (
          <div className={s.list}>
            {shown.map((g) => (
              <button
                key={g.id}
                type="button"
                className={s.row}
                data-open={openId === g.id || undefined}
                data-current={g.current || undefined}
                disabled={g.current}
                onClick={() => open(g.id)}
              >
                <span className={s.gameId}>Game {g.id}</span>
                <span className={s.when}>
                  {when(g.startedAt)}
                  {g.endedAt ? ` → ${when(g.endedAt)}` : ""}
                </span>
                <span className={s.counts}>
                  {g.teams} team{g.teams === 1 ? "" : "s"} · {g.generations} storyboard{g.generations === 1 ? "" : "s"} · {g.submissions} submitted ·{" "}
                  {usd(g.spendUsd, 2)}
                </span>
                <span className={s.tag}>{g.current ? "Live now" : g.winner ? `Winner: ${g.winner}` : "No podium"}</span>
              </button>
            ))}
            {hiddenEmpty > 0 && <p className={s.muted}>{hiddenEmpty} empty game(s) with no teams are not listed.</p>}
          </div>
        )}
      </Panel>

      {openId != null && (
        <Panel
          variant="plain"
          kicker={detail ? `${when(detail.game.startedAt)} → ${when(detail.game.endedAt)}` : "Loading"}
          title={`Game ${openId}`}
          pad="md"
          titleAs="h3"
          actions={
            <Button size="sm" variant="secondary" onClick={() => window.open(`/api/admin/games/${openId}?download=1`, "_blank")}>
              Download everything (JSON)
            </Button>
          }
        >
          {loading || !detail ? (
            <p className={s.muted}>Loading...</p>
          ) : (
            <GameDetail d={detail} />
          )}
        </Panel>
      )}
    </div>
  );
}

function GameDetail({ d }: { d: GameDetailResponse }) {
  const podium = d.ranking.filter((r) => r.score != null).slice(0, 3);
  const teamName = new Map(d.teams.map((t) => [t.slot, t.name]));
  return (
    <div className={s.detail}>
      <p className={s.muted}>
        {d.teams.length} teams · {d.generations.length} storyboards · {d.votes} ratings · {d.feedCount} log events · {usd(d.game.spendUsd, 3)} spent
      </p>

      {podium.length > 0 && (
        <>
          <h4 className={s.h4}>Podium</h4>
          <div className={s.podium}>
            {podium.map((r) => (
              <figure key={r.slot} className={s.card}>
                {r.imageUrl && (
                  <a href={r.imageUrl} target="_blank" rel="noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={r.imageUrl} alt={`Storyboard by ${r.name}`} />
                  </a>
                )}
                <figcaption>
                  <b>{PLACE[r.rank] ?? `#${r.rank}`}</b> {r.name} · {r.score?.toFixed(2)} avg from {r.ratings} rating{r.ratings === 1 ? "" : "s"}
                </figcaption>
              </figure>
            ))}
          </div>
        </>
      )}

      <h4 className={s.h4}>Every storyboard, by team</h4>
      {d.teams.map((t) => {
        const gens = d.generations.filter((g) => g.slot === t.slot);
        return (
          <details key={t.slot} className={s.team} open={d.teams.length <= 4}>
            <summary>
              Team {t.slot}: {t.name} <span className={s.muted}>({gens.length} storyboard{gens.length === 1 ? "" : "s"}, {usd(t.spendUsd, 3)})</span>
            </summary>
            <div className={s.gens}>
              {gens.map((g, i) => (
                <figure key={g.id} className={s.card} data-submitted={g.submitted || undefined}>
                  {g.imageUrl ? (
                    <a href={g.imageUrl} target="_blank" rel="noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={g.imageUrl} alt={`Version ${i + 1} by ${teamName.get(g.slot)}`} />
                    </a>
                  ) : (
                    <div className={s.noImg}>{g.status}</div>
                  )}
                  <figcaption>
                    <b>Version {gens.length - i}</b>
                    {g.submitted ? " · submitted" : ""} · {usd(g.costUsd, 3)}
                  </figcaption>
                  <details className={s.more}>
                    <summary>What they wrote</summary>
                    <dl className={s.fields}>
                      {(["genre", "feeling", "artStyle", "level", "enemy", "ability", "puzzle"] as const).map((k) =>
                        g.inputs?.[k] ? (
                          <div key={k}>
                            <dt>{k === "artStyle" ? "art style" : k}</dt>
                            <dd>{g.inputs[k]}</dd>
                          </div>
                        ) : null,
                      )}
                    </dl>
                    {g.questions && g.questions.length > 0 && (
                      <ul className={s.qa}>
                        {g.questions.map((q, qi) => (
                          <li key={qi}>
                            <b>{q}</b> {g.answers?.[qi] ? g.answers[qi] : <i>(skipped)</i>}
                          </li>
                        ))}
                      </ul>
                    )}
                    {g.imagePrompt && <p className={s.prompt}>{g.imagePrompt}</p>}
                  </details>
                </figure>
              ))}
            </div>
          </details>
        );
      })}
    </div>
  );
}
