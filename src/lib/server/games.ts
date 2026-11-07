// Game sessions: one row per game in game_sessions; past games carry a full JSON snapshot.
import "server-only";
import type { DesignFields, GameDetailResponse, GameSummary, PastGeneration, PastTeam, RankingEntry } from "@/lib/types";
import { iso, isoOrNull, num, q, q1, type Row } from "./db";

type Snap = {
  event?: { ranking?: unknown };
  teams?: Row[];
  generations?: Row[];
  feed?: Row[];
  votes?: Row[];
};

const arr = (v: unknown): string[] | null => (Array.isArray(v) ? v.map(String) : null);
const round4 = (n: number) => Math.round(n * 10000) / 10000;

function winnerOf(snap: Snap | null): string | null {
  const ranking = Array.isArray(snap?.event?.ranking) ? (snap!.event!.ranking as RankingEntry[]) : [];
  return ranking.find((r) => r.rank === 1 && r.score != null)?.name ?? null;
}

/** Every game, newest first. The live game's counts come from the live tables. */
export async function listGames(): Promise<GameSummary[]> {
  const [live] = await q("SELECT epoch FROM event_state WHERE id = 1");
  const current = Number(live?.epoch);
  const rows = await q(
    `SELECT id, started_at, ended_at, team_count, generation_count, submission_count, spend_usd,
            snapshot->'event'->'ranking' AS ranking
       FROM game_sessions ORDER BY id DESC`,
  );
  const liveCounts = await q1(
    `SELECT (SELECT count(*) FROM teams) AS teams, (SELECT count(*) FROM generations) AS gens,
            (SELECT count(*) FROM teams WHERE submitted_generation_id IS NOT NULL) AS subs,
            (SELECT COALESCE(sum(spend_usd), 0) FROM teams) AS spend`,
  );
  return rows.map((r) => {
    const isCurrent = Number(r.id) === current;
    return {
      id: Number(r.id),
      current: isCurrent,
      startedAt: iso(r.started_at),
      endedAt: isoOrNull(r.ended_at),
      teams: isCurrent ? Number(liveCounts?.teams ?? 0) : Number(r.team_count ?? 0),
      generations: isCurrent ? Number(liveCounts?.gens ?? 0) : Number(r.generation_count ?? 0),
      submissions: isCurrent ? Number(liveCounts?.subs ?? 0) : Number(r.submission_count ?? 0),
      spendUsd: round4(isCurrent ? num(liveCounts?.spend) : num(r.spend_usd)),
      winner: isCurrent ? null : winnerOf({ event: { ranking: r.ranking } }),
    };
  });
}

/** Raw snapshot of a past game (for download), or null. */
export async function gameSnapshot(id: number): Promise<{ row: Row; snap: Snap } | null> {
  const row = await q1("SELECT * FROM game_sessions WHERE id = $1 AND snapshot IS NOT NULL", [id]);
  return row ? { row, snap: row.snapshot as Snap } : null;
}

export function gameDetail(row: Row, snap: Snap): GameDetailResponse {
  const teams: PastTeam[] = (snap.teams ?? []).map((t) => ({
    slot: Number(t.slot),
    name: String(t.name),
    spendUsd: round4(num(t.spend_usd)),
    submittedGenerationId: t.submitted_generation_id ?? null,
  }));
  const submitted = new Set(teams.map((t) => t.submittedGenerationId).filter(Boolean));
  const generations: PastGeneration[] = (snap.generations ?? []).map((g) => ({
    id: String(g.id),
    slot: Number(g.slot),
    createdAt: String(g.created_at),
    status: String(g.status),
    imageUrl: g.image_url ?? null,
    inputs: g.inputs as DesignFields,
    questions: arr(g.questions),
    answers: arr(g.answers),
    imagePrompt: g.image_prompt ?? null,
    changesMade: arr(g.changes_made),
    costUsd: round4(num(g.cost_usd)),
    submitted: submitted.has(String(g.id)),
  }));
  const ranking = Array.isArray(snap.event?.ranking) ? (snap.event!.ranking as RankingEntry[]) : [];
  return {
    game: {
      id: Number(row.id),
      current: false,
      startedAt: iso(row.started_at),
      endedAt: isoOrNull(row.ended_at),
      teams: teams.length,
      generations: generations.length,
      submissions: teams.filter((t) => t.submittedGenerationId).length,
      spendUsd: round4(num(row.spend_usd)),
      winner: winnerOf(snap),
    },
    ranking,
    teams,
    generations,
    feedCount: (snap.feed ?? []).length,
    votes: (snap.votes ?? []).length,
  };
}
