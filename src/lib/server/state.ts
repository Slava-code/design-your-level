// Role-aware snapshots for GET /api/state (and reused by mutation responses).
import "server-only";
import type {
  AdminState,
  AdminTeamRow,
  AnonState,
  AssignedDesign,
  FeedItem,
  GenerationStatus,
  Scores,
  StateBase,
  TeamActivity,
  TeamState,
} from "@/lib/types";
import { estimateFollowupUsd, estimateGenerationUsd } from "@/lib/ai";
import { batch, iso, isoOrNull, num, q, type Row } from "./db";
import { EVENT_SQL, type EventRow } from "./event";
import { generationView, teamSummary } from "./views";
import { rankingOf, revealState } from "./voting";
import { refsPrefix } from "./blob";
import { slotCount } from "./config";

export function base(event: EventRow): StateBase {
  return {
    phase: event.phase,
    phaseStartedAt: iso(event.phase_started_at),
    phaseEndsAt: isoOrNull(event.phase_ends_at),
    timerPausedMs: event.timer_paused_ms == null ? null : Number(event.timer_paused_ms),
    serverNow: new Date().toISOString(),
    epoch: Number(event.epoch),
  };
}

export function anonState(event: EventRow, sessionExpired: boolean): AnonState {
  return { ...base(event), role: "anon", sessionExpired };
}

const TEAM_SQL = "SELECT * FROM teams WHERE slot = $1";
const GENS_SQL = "SELECT * FROM generations WHERE slot = $1 ORDER BY created_at DESC, id DESC";
const ASSIGNED_SQL = `
  SELECT a.generation_id, a.position, g.inputs, g.image_url, g.panel_captions,
         v.level, v.enemy, v.ability, v.puzzle
    FROM assignments a
    JOIN generations g ON g.id = a.generation_id
    LEFT JOIN votes v ON v.voter_slot = a.voter_slot AND v.target_slot = a.target_slot
   WHERE a.voter_slot = $1
   ORDER BY a.position, a.target_slot`;

/** Event + team data in one round trip. Returns null team if the row is missing. */
export async function loadTeamBundle(slot: number) {
  const [ev, team, gens, assigned] = await batch(
    [
      [EVENT_SQL, []],
      [TEAM_SQL, [slot]],
      [GENS_SQL, [slot]],
      [ASSIGNED_SQL, [slot]],
    ],
    { readOnly: true },
  );
  return { event: ev[0] as EventRow, team: team[0] ?? null, gens, assigned };
}

export function buildTeamState(bundle: { event: EventRow; team: Row; gens: Row[]; assigned: Row[] }): TeamState {
  const { event, team, gens, assigned } = bundle;
  const summary = teamSummary(team);
  const submittedId = summary.submittedGenerationId;
  const generations = gens.map((g) => generationView(g, submittedId));
  const hadFollowups = gens.some((g) => g.questions != null);

  let voting: TeamState["voting"] = null;
  // voting_frozen_at is set once the assignments are written (a moment after the phase flips);
  // until then voting stays null and the team sees "Voting is getting set up".
  if (event.phase === "VOTING" && event.voting_frozen_at != null) {
    const list: AssignedDesign[] = assigned.map((a, i) => ({
      target: String(a.generation_id),
      position: i + 1,
      inputs: a.inputs,
      imageUrl: a.image_url ?? null,
      panelCaptions: Array.isArray(a.panel_captions) ? a.panel_captions : null,
      myVote: a.level == null ? null : ({ level: a.level, enemy: a.enemy, ability: a.ability, puzzle: a.puzzle } as Scores),
    }));
    voting = { assigned: list, done: list.filter((x) => x.myVote).length, total: list.length };
  }

  return {
    ...base(event),
    role: "team",
    team: summary,
    generations,
    submittedGenerationId: submittedId,
    canRename: event.phase === "LOBBY" || event.phase === "DESIGN",
    uploadPrefix: refsPrefix(Number(event.epoch), summary.slot),
    nextGenerateAsksQuestions: !hadFollowups,
    estimates: { generateUsd: estimateGenerationUsd(0), withQuestionsUsd: estimateFollowupUsd(0) + estimateGenerationUsd(0) },
    voting,
    reveal: revealState(event),
  };
}

const ADMIN_TEAMS_SQL = `
  SELECT t.*,
    (SELECT count(*) FROM generations g WHERE g.slot = t.slot AND g.status <> 'flagged') AS gen_count,
    (SELECT g.status FROM generations g WHERE g.slot = t.slot AND g.status <> 'flagged' ORDER BY g.created_at DESC LIMIT 1) AS latest_status,
    (SELECT g.image_url FROM generations g WHERE g.id = t.submitted_generation_id) AS submitted_image_url,
    (SELECT count(*) FROM votes v WHERE v.voter_slot = t.slot) AS votes_cast,
    (SELECT count(*) FROM assignments a WHERE a.voter_slot = t.slot) AS votes_assigned,
    (now() - t.last_seen_at) < interval '15 seconds' AS online
  FROM teams t ORDER BY t.slot`;

const GEN_TOTALS_SQL = `SELECT count(*) FILTER (WHERE status = 'done') AS done,
                               count(*) FILTER (WHERE status IN ('asking','questions','generating')) AS inflight
                          FROM generations`;

function activity(latest: GenerationStatus | null, submitted: boolean): TeamActivity {
  if (latest === "asking") return "asking";
  if (latest === "questions") return "answering";
  if (latest === "generating") return "generating";
  return submitted ? "submitted" : "drafting";
}

export function adminTeamRow(t: Row): AdminTeamRow {
  return {
    ...teamSummary(t),
    joinedAt: iso(t.joined_at),
    lastSeenAt: iso(t.last_seen_at),
    online: !!t.online,
    generationCount: num(t.gen_count),
    activity: activity(t.latest_status ?? null, !!t.submitted_generation_id),
    submittedImageUrl: t.submitted_image_url ?? null,
    votesCast: num(t.votes_cast),
    votesAssigned: num(t.votes_assigned),
  };
}

export async function loadAdminTeam(slot: number): Promise<AdminTeamRow | null> {
  const rows = await q(ADMIN_TEAMS_SQL.replace("FROM teams t ORDER BY t.slot", "FROM teams t WHERE t.slot = $1"), [slot]);
  return rows[0] ? adminTeamRow(rows[0]) : null;
}

export async function buildAdminState(view: "admin" | "screen", since: number | null): Promise<AdminState> {
  const feedSql =
    since != null
      ? `SELECT f.*, t.name AS team_name FROM feed f LEFT JOIN teams t ON t.slot = f.slot WHERE f.id > $1 ORDER BY f.id ASC LIMIT 100`
      : `SELECT * FROM (SELECT f.*, t.name AS team_name FROM feed f LEFT JOIN teams t ON t.slot = f.slot ORDER BY f.id DESC LIMIT 100) x ORDER BY id ASC`;
  const [ev, teamRows, feedRows, genTotals, maxFeed] = await batch(
    [
      [EVENT_SQL, []],
      [ADMIN_TEAMS_SQL, []],
      [feedSql, since != null ? [since] : []],
      [GEN_TOTALS_SQL, []],
      ["SELECT COALESCE(max(id), 0) AS max FROM feed", []],
    ],
    { readOnly: true },
  );
  const event = ev[0] as EventRow;
  const teams = teamRows.map(adminTeamRow);
  const feed: FeedItem[] = feedRows.map((f) => ({
    id: Number(f.id),
    ts: iso(f.ts),
    type: f.type,
    slot: f.slot == null ? null : Number(f.slot),
    teamName: f.team_name ?? null,
    payload: f.payload ?? {},
  }));
  const feedCursor = feed.length ? feed[feed.length - 1].id : Math.min(since ?? Number(maxFeed[0]?.max ?? 0), Number(maxFeed[0]?.max ?? 0));
  const sum = (f: (t: AdminTeamRow) => number) => Math.round(teams.reduce((a, t) => a + f(t), 0) * 10000) / 10000;
  const showRanking = view === "admin" && (event.phase === "REVEAL" || event.phase === "CLOSED");

  return {
    ...base(event),
    role: view,
    teams,
    feed,
    feedCursor,
    totals: {
      totalSpendUsd: sum((t) => t.spendUsd),
      totalReservedUsd: sum((t) => t.reservedUsd),
      teamsJoined: teams.length,
      submissions: teams.filter((t) => t.submittedGenerationId).length,
      generationsDone: num(genTotals[0]?.done),
      inFlight: num(genTotals[0]?.inflight),
      votesCast: sum((t) => t.votesCast),
      votesAssigned: sum((t) => t.votesAssigned),
      votersDone: teams.filter((t) => t.votesAssigned > 0 && t.votesCast >= t.votesAssigned).length,
    },
    reveal: revealState(event),
    ranking: showRanking ? rankingOf(event) : null,
    slotsConfigured: slotCount(),
  };
}

const lastSeenWrites = new Map<number, number>();
/** Throttled last_seen_at update (at most every 10 s per team per instance, and only if stale in the DB). */
export async function touchLastSeen(slot: number): Promise<void> {
  const now = Date.now();
  if (now - (lastSeenWrites.get(slot) ?? 0) < 10_000) return;
  lastSeenWrites.set(slot, now);
  await q("UPDATE teams SET last_seen_at = now() WHERE slot = $1 AND last_seen_at < now() - interval '10 seconds'", [slot]);
}
