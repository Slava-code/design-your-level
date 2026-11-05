// Admin operations: phase changes (with assignment/ranking computation), timer, reveal, reset.
import "server-only";
import { PHASES, type Phase, type RevealState, type Scores } from "@/lib/types";
import { list, del } from "@vercel/blob";
import { batch, q, type Row } from "./db";
import { ApiErr } from "./http";
import { getEvent, type EventRow } from "./event";
import { logFeed } from "./feed";
import { computeAssignments, computeRanking, podium, rankingOf, revealState } from "./voting";
import { blobNamespace } from "./config";

const clampDuration = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 4 * 3600) throw new ApiErr("bad_request", "durationSec must be between 0 and 14400.");
  return n > 0 ? Math.round(n) : null;
};

/**
 * Compute and store vote assignments from the submissions as they are now. Called only after the phase
 * row already says VOTING: /api/submit takes a share lock on event_state and re-checks the phase, so no
 * submission can land after the SELECT below (a submit in progress when the phase flipped either
 * committed before the flip or now fails with "Submissions are closed"). FOR UPDATE additionally waits
 * for any team-row write still in progress and reads its committed value.
 */
async function freezeAndAssign(): Promise<{ assignments: number; submitters: number; warning?: string }> {
  const teams = await q("SELECT slot, submitted_generation_id FROM teams ORDER BY slot FOR UPDATE");
  const submitted = teams
    .filter((t) => t.submitted_generation_id)
    .map((t) => ({ slot: Number(t.slot), generationId: String(t.submitted_generation_id) }));
  const assignments = computeAssignments(
    teams.map((t) => Number(t.slot)),
    submitted,
    4,
  );
  const queries: [string, unknown[]][] = [["DELETE FROM assignments", []]];
  if (assignments.length) {
    const values: string[] = [];
    const params: unknown[] = [];
    assignments.forEach((a, i) => {
      const b = i * 4;
      values.push(`($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4})`);
      params.push(a.voter, a.target, a.generationId, a.position);
    });
    // ON CONFLICT: a concurrent repair run computes the same rows, so a duplicate must never fail.
    queries.push([
      `INSERT INTO assignments (voter_slot, target_slot, generation_id, position) VALUES ${values.join(",")}
       ON CONFLICT (voter_slot, target_slot) DO UPDATE SET generation_id = EXCLUDED.generation_id, position = EXCLUDED.position`,
      params,
    ]);
  }
  // Drop votes that no longer match an assignment (e.g. after going back to DESIGN and resubmitting).
  queries.push([
    `DELETE FROM votes v WHERE NOT EXISTS (
       SELECT 1 FROM assignments a JOIN teams t ON t.slot = a.target_slot AND t.submitted_generation_id = a.generation_id
        WHERE a.voter_slot = v.voter_slot AND a.target_slot = v.target_slot)`,
    [],
  ]);
  // Assignments are in place: team screens switch from "Voting is getting set up" to their designs.
  queries.push(["UPDATE event_state SET voting_frozen_at = now(), updated_at = now() WHERE id = 1 AND phase = 'VOTING'", []]);
  await batch(queries);
  const warning =
    submitted.length === 0
      ? "No team has submitted, so there is nothing to rate."
      : submitted.length < 2
        ? "Only one design was submitted."
        : undefined;
  return { assignments: assignments.length, submitters: submitted.length, warning };
}

/**
 * Ranking of the frozen designs. Each team's design is the one its voters were assigned
 * (assignments.generation_id), and only votes cast against that exact design count. A team with a
 * submission but no assignments (e.g. the only team) falls back to its submitted design.
 */
async function buildRanking() {
  const [subs, votes] = await batch(
    [
      [
        `SELECT t.slot, t.name, f.gid AS generation_id, t.submitted_at, g.image_url, g.panel_captions, g.inputs
           FROM teams t
           CROSS JOIN LATERAL (SELECT COALESCE(
               (SELECT a.generation_id FROM assignments a WHERE a.target_slot = t.slot ORDER BY a.voter_slot LIMIT 1),
               t.submitted_generation_id) AS gid) f
           JOIN generations g ON g.id = f.gid
          ORDER BY t.slot`,
        [],
      ],
      [
        `SELECT a.target_slot, a.generation_id, v.level, v.enemy, v.ability, v.puzzle
           FROM votes v JOIN assignments a USING (voter_slot, target_slot)`,
        [],
      ],
    ],
    { readOnly: true },
  );
  const byTarget = new Map<string, Scores[]>();
  for (const v of votes) {
    const k = `${Number(v.target_slot)}:${String(v.generation_id)}`;
    if (!byTarget.has(k)) byTarget.set(k, []);
    byTarget.get(k)!.push({ level: v.level, enemy: v.enemy, ability: v.ability, puzzle: v.puzzle });
  }
  return computeRanking(
    subs.map((s: Row) => ({
      slot: Number(s.slot),
      name: String(s.name),
      generationId: String(s.generation_id),
      imageUrl: s.image_url ?? null,
      panelCaptions: Array.isArray(s.panel_captions) ? s.panel_captions : null,
      inputs: s.inputs,
      submittedAt: s.submitted_at ? new Date(s.submitted_at).getTime() : 0,
      votes: byTarget.get(`${Number(s.slot)}:${String(s.generation_id)}`) ?? [],
    })),
  );
}

export async function changePhase(to: Phase, durationSecRaw: unknown): Promise<{ event: EventRow; warning?: string }> {
  if (!PHASES.includes(to)) throw new ApiErr("bad_request", "Unknown phase.");
  const durationSec = clampDuration(durationSecRaw);
  const ev = await getEvent();
  const from = ev.phase;
  const di = PHASES.indexOf(to) - PHASES.indexOf(from);
  if (Math.abs(di) > 1) throw new ApiErr("phase", `Can't jump from ${from} to ${to}; go one step at a time.`);

  if (di === 0) {
    // Same phase: only (re)set the timer. Also repair a VOTING/REVEAL whose follow-up step failed
    // (a DB blip right after the flip): assignments or ranking still missing well after the phase began.
    await q(
      `UPDATE event_state SET phase_ends_at = CASE WHEN $1::int IS NULL THEN NULL ELSE now() + ($1::int * interval '1 second') END,
              updated_at = now() WHERE id = 1`,
      [durationSec],
    );
    const stale = new Date(ev.now).getTime() - new Date(ev.phase_started_at).getTime() > 5000;
    if (stale && to === "VOTING" && ev.voting_frozen_at == null) await freezeAndAssign();
    if (stale && to === "REVEAL" && ev.ranking == null) {
      await q("UPDATE event_state SET ranking = $1::jsonb, reveal_step = 0 WHERE id = 1 AND phase = 'REVEAL'", [
        JSON.stringify(await buildRanking()),
      ]);
    }
    return { event: await getEvent() };
  }

  // Into REVEAL: store a ranking with the flip itself, so the projector never sees REVEAL without one.
  const preRanking = from === "VOTING" && to === "REVEAL" ? await buildRanking() : null;

  // The flip is conditional on the phase we read, so of two simultaneous clicks only one wins and runs
  // the follow-up work; the other is a harmless no-op. /api/submit and /api/vote lock this row and
  // re-check the phase, so once this commits no submission or vote for the old phase can land.
  const flipped = await q(
    `UPDATE event_state SET phase = $1, phase_started_at = now(),
            phase_ends_at = CASE WHEN $2::int IS NULL THEN NULL ELSE now() + ($2::int * interval '1 second') END,
            voting_frozen_at = CASE WHEN $1 IN ('LOBBY','DESIGN') OR ($1 = 'VOTING' AND $3 = 'DESIGN') THEN NULL
                                    ELSE voting_frozen_at END,
            reveal_step = CASE WHEN $1 IN ('REVEAL','CLOSED') AND $3 IN ('REVEAL','CLOSED') THEN reveal_step ELSE 0 END,
            ranking = CASE WHEN $1 = 'REVEAL' AND $3 = 'VOTING' THEN $4::jsonb
                           WHEN $1 IN ('REVEAL','CLOSED') THEN ranking ELSE NULL END,
            updated_at = now()
      WHERE id = 1 AND phase = $3
      RETURNING phase`,
    [to, durationSec, from, preRanking ? JSON.stringify(preRanking) : null],
  );
  if (!flipped.length) return { event: await getEvent() }; // another click changed the phase first

  let warning: string | undefined;
  if (from === "DESIGN" && to === "VOTING") warning = (await freezeAndAssign()).warning;
  if (from === "VOTING" && to === "REVEAL") {
    // Recompute now that voting is closed, in case a vote landed between the first read and the flip.
    const ranking = await buildRanking();
    if (JSON.stringify(ranking) !== JSON.stringify(preRanking)) {
      await q("UPDATE event_state SET ranking = $1::jsonb WHERE id = 1 AND phase = 'REVEAL'", [JSON.stringify(ranking)]);
    }
    if (ranking.length === 0) warning = "No submitted designs to rank.";
  }
  await logFeed("phase", null, { from, to, durationSec });
  return { event: await getEvent(), warning };
}

export async function adjustTimer(addSec: unknown, setSec: unknown): Promise<EventRow> {
  if (setSec != null) {
    const n = Number(setSec);
    if (!Number.isFinite(n) || n < 0 || n > 4 * 3600) throw new ApiErr("bad_request", "setSec must be between 0 and 14400.");
    await q(
      `UPDATE event_state SET phase_ends_at = CASE WHEN $1::int = 0 THEN NULL ELSE now() + ($1::int * interval '1 second') END,
              updated_at = now() WHERE id = 1`,
      [Math.round(n)],
    );
  } else if (addSec != null) {
    const n = Number(addSec);
    if (!Number.isFinite(n) || Math.abs(n) > 3600) throw new ApiErr("bad_request", "addSec must be between -3600 and 3600.");
    await q(
      `UPDATE event_state SET phase_ends_at = GREATEST(COALESCE(phase_ends_at, now()), now()) + ($1::int * interval '1 second'),
              updated_at = now() WHERE id = 1`,
      [Math.round(n)],
    );
  } else {
    throw new ApiErr("bad_request", "Send addSec or setSec.");
  }
  await logFeed("timer", null, { addSec: addSec ?? null, setSec: setSec ?? null });
  return getEvent();
}

/**
 * Move the podium reveal. `fromStep` (the step the admin's screen showed when clicking) makes the move
 * conditional, so a double click or a second admin tab can't skip a place; a lost race returns the
 * current state instead of an error.
 */
export async function moveReveal(action: unknown, fromStep?: unknown): Promise<RevealState> {
  const ev = await getEvent();
  if (ev.phase !== "REVEAL") throw new ApiErr("phase", "The podium can only be revealed during REVEAL.");
  const max = podium(rankingOf(ev)).length;
  const expr = action === "next" ? "reveal_step + 1" : action === "prev" ? "reveal_step - 1" : action === "reset" ? "0" : null;
  if (!expr) throw new ApiErr("bad_request", 'action must be "next", "prev" or "reset".');
  const from = typeof fromStep === "number" && Number.isInteger(fromStep) ? fromStep : null;
  const rows = await q(
    `UPDATE event_state SET reveal_step = GREATEST(0, LEAST(${expr}, $1::int)), updated_at = now()
      WHERE id = 1 AND phase = 'REVEAL' AND ($2::int IS NULL OR reveal_step = $2::int) RETURNING reveal_step`,
    [max, from],
  );
  if (!rows.length) {
    const cur = await getEvent();
    if (cur.phase !== "REVEAL") throw new ApiErr("phase", "The podium can only be revealed during REVEAL.");
    return revealState(cur)!;
  }
  const step = Number(rows[0].reveal_step);
  await logFeed("reveal", null, { step });
  return revealState({ ...ev, reveal_step: step })!;
}

/** Wipe everything, bump the epoch (logs everyone out) and delete this namespace's old Blob files.
 *  First saves a JSON snapshot of the whole event into event_archive (same transaction), so the logs
 *  survive the reset. Skipped when there is nothing to save. */
export async function resetEvent(): Promise<{ epoch: number; blobsDeleted: number; blobError?: string }> {
  const results = await batch([
    [
      `INSERT INTO event_archive (epoch, snapshot)
       SELECT e.epoch, jsonb_build_object(
                'event', to_jsonb(e),
                'teams', COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.slot) FROM teams t), '[]'::jsonb),
                'generations', COALESCE((SELECT jsonb_agg(to_jsonb(g) ORDER BY g.created_at) FROM generations g), '[]'::jsonb),
                'feed', COALESCE((SELECT jsonb_agg(to_jsonb(f) ORDER BY f.id) FROM feed f), '[]'::jsonb),
                'assignments', COALESCE((SELECT jsonb_agg(to_jsonb(a)) FROM assignments a), '[]'::jsonb),
                'votes', COALESCE((SELECT jsonb_agg(to_jsonb(v)) FROM votes v), '[]'::jsonb))
         FROM event_state e
        WHERE e.id = 1 AND (EXISTS (SELECT 1 FROM teams) OR EXISTS (SELECT 1 FROM feed))`,
      [],
    ],
    ["DELETE FROM votes", []],
    ["DELETE FROM assignments", []],
    ["DELETE FROM generations", []],
    ["DELETE FROM teams", []],
    ["DELETE FROM feed", []],
    ["DELETE FROM join_attempts", []],
    [
      `UPDATE event_state SET epoch = epoch + 1, phase = 'LOBBY', phase_started_at = now(), phase_ends_at = NULL,
              reveal_step = 0, voting_frozen_at = NULL, ranking = NULL, updated_at = now()
        WHERE id = 1 RETURNING epoch`,
      [],
    ],
  ]);
  const epoch = Number(results[7][0].epoch);
  let blobsDeleted = 0;
  let blobError: string | undefined;
  try {
    // Everything under <ns>ev<N>/ except the new epoch (also catches late uploads from older epochs).
    const ns = blobNamespace();
    const keep = `${ns}ev${epoch}/`;
    let cursor: string | undefined;
    do {
      const page = await list({ prefix: `${ns}ev`, cursor, limit: 1000 });
      const doomed = page.blobs.filter((b) => !b.pathname.startsWith(keep) && /^ev\d+\//.test(b.pathname.slice(ns.length)));
      if (doomed.length) {
        await del(doomed.map((b) => b.url));
        blobsDeleted += doomed.length;
      }
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
  } catch (e) {
    blobError = e instanceof Error ? e.message : String(e);
    console.error("[reset] blob cleanup failed:", blobError);
  }
  return { epoch, blobsDeleted, blobError };
}
