// Budget accounting. Every AI call is preceded by an atomic reservation against the team's budget
// (spend + reserved + estimate <= budget), recorded on the generation row (generations.reserved_usd),
// then settled: actual cost is added to spend as it is incurred and the reservation released when the
// generation leaves asking/generating. All multi-row changes are single SQL statements (atomic).
import "server-only";
import { q, q1, type Row } from "./db";

const EPS = 1e-9;

/**
 * Atomically reserve `est` on the team and insert a new generation holding it.
 * Returns the new row, or null if the budget is insufficient.
 * Throws a unique violation (23505) if the team already has a generation in flight.
 */
export async function reserveAndInsertGeneration(args: {
  id: string;
  slot: number;
  est: number;
  status: "asking" | "generating";
  askQuestions: boolean;
  inputs: unknown;
  refs: unknown;
  modelText: string;
  modelImage: string;
}): Promise<Row | null> {
  return q1(
    `WITH r AS (
       UPDATE teams SET reserved_usd = reserved_usd + $3
        WHERE slot = $2 AND spend_usd + reserved_usd + $3 <= budget_usd + ${EPS}
        RETURNING slot)
     INSERT INTO generations (id, slot, status, ask_questions, inputs, refs, reserved_usd, model_text, model_image, stage_at)
     SELECT $1, r.slot, $4, $5, $6::jsonb, $7::jsonb, $3, $8, $9, now() FROM r
     RETURNING *`,
    [args.id, args.slot, args.est, args.status, args.askQuestions, JSON.stringify(args.inputs), JSON.stringify(args.refs), args.modelText, args.modelImage],
  );
}

/** Insert a flagged generation (no reservation, no charge). */
export async function insertFlaggedGeneration(args: { id: string; slot: number; inputs: unknown; refs: unknown; message: string; detail: string }): Promise<Row> {
  const row = await q1(
    `INSERT INTO generations (id, slot, status, inputs, refs, error, error_detail)
     VALUES ($1, $2, 'flagged', $3::jsonb, $4::jsonb, $5, $6) RETURNING *`,
    [args.id, args.slot, JSON.stringify(args.inputs), JSON.stringify(args.refs), args.message, args.detail],
  );
  return row!;
}

/**
 * questions -> generating with a fresh reservation of `est` and the team's answers.
 * Returns the updated row or null (not found / not waiting for answers / budget).
 */
export async function reserveForAnswers(id: string, slot: number, est: number, answers: string[]): Promise<Row | null> {
  return q1(
    `WITH g AS (SELECT id, slot FROM generations WHERE id = $1 AND slot = $2 AND status = 'questions' FOR UPDATE),
     r AS (
       UPDATE teams SET reserved_usd = teams.reserved_usd + $3 FROM g
        WHERE teams.slot = g.slot AND teams.spend_usd + teams.reserved_usd + $3 <= teams.budget_usd + ${EPS}
        RETURNING teams.slot)
     UPDATE generations SET status = 'generating', answers = $4::jsonb, reserved_usd = $3, stage_at = now(), updated_at = now()
       FROM r WHERE generations.id = $1
     RETURNING generations.*`,
    [id, slot, est, JSON.stringify(answers)],
  );
}

/** Add actual cost to the generation and the team's spend (reservation untouched). Always applied. */
export async function charge(id: string, usd: number): Promise<void> {
  if (!(usd > 0)) return;
  await q(
    `WITH g AS (UPDATE generations SET cost_usd = cost_usd + $2, updated_at = now() WHERE id = $1 RETURNING slot)
     UPDATE teams SET spend_usd = spend_usd + $2 FROM g WHERE teams.slot = g.slot`,
    [id, usd],
  );
}

/**
 * Release part of a generation's reservation (e.g. the image estimate when the follow-up round
 * ends with questions). Only while the generation is still in one of `from`.
 */
export async function releasePart(id: string, usd: number, from: string[]): Promise<void> {
  await q(
    `WITH g AS (SELECT id, slot, LEAST(reserved_usd, $2) AS amt FROM generations WHERE id = $1 AND status = ANY($3) FOR UPDATE),
     u AS (UPDATE generations SET reserved_usd = generations.reserved_usd - g.amt, updated_at = now() FROM g WHERE generations.id = g.id RETURNING g.slot, g.amt)
     UPDATE teams SET reserved_usd = GREATEST(teams.reserved_usd - u.amt, 0) FROM u WHERE teams.slot = u.slot`,
    [id, usd, from],
  );
}

/**
 * Move a generation from one of `from` to `to`, releasing its whole remaining reservation, and
 * applying extra column updates. Returns the updated row, or null if it was no longer in `from`
 * (e.g. the sweeper got there first).
 */
export async function finish(
  id: string,
  from: string[],
  to: string,
  patch: { error?: string | null; errorDetail?: string | null; imageUrl?: string | null; questions?: string[] | null; msImage?: number | null; msText?: number | null } = {},
  opts: { releaseAll?: boolean; stage?: boolean } = { releaseAll: true },
): Promise<Row | null> {
  const releaseAll = opts.releaseAll !== false;
  return q1(
    `WITH g AS (SELECT id, slot, reserved_usd FROM generations WHERE id = $1 AND status = ANY($2) FOR UPDATE),
     u AS (
       UPDATE generations SET
         status = $3,
         reserved_usd = CASE WHEN $4 THEN 0 ELSE generations.reserved_usd END,
         error = COALESCE($5, generations.error),
         error_detail = COALESCE($6, generations.error_detail),
         image_url = COALESCE($7, generations.image_url),
         questions = COALESCE($8::jsonb, generations.questions),
         ms_image = COALESCE($9, generations.ms_image),
         ms_text = COALESCE($10, generations.ms_text),
         stage_at = CASE WHEN $11 THEN now() ELSE generations.stage_at END,
         updated_at = now()
       FROM g WHERE generations.id = g.id
       RETURNING generations.*, g.reserved_usd AS held),
     t AS (
       UPDATE teams SET reserved_usd = GREATEST(teams.reserved_usd - CASE WHEN $4 THEN u.held ELSE 0 END, 0)
         FROM u WHERE teams.slot = u.slot RETURNING teams.slot)
     SELECT u.* FROM u`,
    [
      id,
      from,
      to,
      releaseAll,
      patch.error ?? null,
      patch.errorDetail ?? null,
      patch.imageUrl ?? null,
      patch.questions ? JSON.stringify(patch.questions) : null,
      patch.msImage ?? null,
      patch.msText ?? null,
      !!opts.stage,
    ],
  );
}

let lastSweep = 0;
/**
 * Stuck-work sweeper: anything in asking/generating whose stage started more than `stuckMs` ago
 * becomes error and its reservation is released. Throttled per server instance.
 */
export async function sweepStuck(stuckMs: number, force = false): Promise<number> {
  const now = Date.now();
  if (!force && now - lastSweep < 15_000) return 0;
  lastSweep = now;
  const rows = await q(
    `WITH g AS (
       SELECT id, slot, reserved_usd FROM generations
        WHERE status IN ('asking','generating') AND stage_at < now() - ($1::double precision * interval '1 millisecond')
        FOR UPDATE SKIP LOCKED),
     u AS (
       UPDATE generations SET status = 'error', reserved_usd = 0, updated_at = now(),
              error = 'This took too long and was stopped. Nothing extra was charged; try again.',
              error_detail = 'swept: stuck in ' || generations.status
         FROM g WHERE generations.id = g.id RETURNING g.id, g.slot, g.reserved_usd AS held),
     s AS (SELECT slot, sum(held) AS held FROM u GROUP BY slot),
     t AS (UPDATE teams SET reserved_usd = GREATEST(teams.reserved_usd - s.held, 0) FROM s WHERE teams.slot = s.slot RETURNING teams.slot)
     SELECT u.id, u.slot FROM u`,
    [stuckMs],
  );
  if (rows.length) {
    const { logFeed } = await import("./feed");
    for (const r of rows) await logFeed("error", Number(r.slot), { generationId: r.id, message: "timed out" });
  }
  return rows.length;
}

/** spend -> 0; reserved -> exactly what in-flight generations still hold. Keeps all work. */
export async function resetTeamBudget(slot: number): Promise<Row | null> {
  return q1(
    `UPDATE teams SET spend_usd = 0,
            reserved_usd = COALESCE((SELECT sum(reserved_usd) FROM generations WHERE slot = $1 AND status IN ('asking','generating')), 0)
      WHERE slot = $1 RETURNING *`,
    [slot],
  );
}
