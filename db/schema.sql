-- Design Your Level: database schema.
-- Idempotent: every statement is safe to re-run (scripts/migrate.mjs applies this file).
-- Statements are split on a semicolon at the end of a line, so keep one statement per
-- ";\n" and never use DO $$ blocks here.
--
-- Codes are never stored. A team is identified by its slot (1-based position in TEAM_CODES).
-- Money columns are double precision dollars.

-- Singleton row with the live event state.
CREATE TABLE IF NOT EXISTS event_state (
  id              int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  phase           text NOT NULL DEFAULT 'LOBBY' CHECK (phase IN ('LOBBY','DESIGN','VOTING','REVEAL','CLOSED')),
  phase_started_at timestamptz NOT NULL DEFAULT now(),
  phase_ends_at   timestamptz,
  epoch           int NOT NULL DEFAULT 1,
  reveal_step     int NOT NULL DEFAULT 0,
  -- Set when VOTING starts (submissions frozen, assignments computed); cleared on going back to DESIGN.
  voting_frozen_at timestamptz,
  -- Full ranking computed when REVEAL starts (array of RankingEntry, see src/lib/types.ts).
  ranking         jsonb,
  updated_at      timestamptz NOT NULL DEFAULT now()
);
INSERT INTO event_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS teams (
  slot            int PRIMARY KEY CHECK (slot >= 1),
  name            text NOT NULL,
  joined_at       timestamptz NOT NULL DEFAULT now(),
  last_seen_at    timestamptz NOT NULL DEFAULT now(),
  spend_usd       double precision NOT NULL DEFAULT 0,
  reserved_usd    double precision NOT NULL DEFAULT 0,
  budget_usd      double precision NOT NULL DEFAULT 5,
  submitted_generation_id text,
  submitted_at    timestamptz
);

CREATE TABLE IF NOT EXISTS generations (
  id              text PRIMARY KEY,
  slot            int NOT NULL REFERENCES teams(slot) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  -- When the current asking/generating stage started (used by the stuck-work sweeper).
  stage_at        timestamptz NOT NULL DEFAULT now(),
  status          text NOT NULL CHECK (status IN ('asking','questions','generating','done','refused','error','flagged')),
  ask_questions   boolean NOT NULL DEFAULT false,
  inputs          jsonb NOT NULL,          -- DesignFields
  refs            jsonb NOT NULL DEFAULT '[]'::jsonb, -- RefImage[]
  questions       jsonb,                   -- string[] or null if no follow-up round
  answers         jsonb,                   -- string[] aligned with questions
  image_prompt    text,
  panel_captions  jsonb,
  reference_roles jsonb,
  changes_made    jsonb,
  model_text      text,
  model_image     text,
  error           text,                    -- friendly message shown to the team
  error_detail    text,                    -- admin-only detail
  image_url       text,
  cost_usd        double precision NOT NULL DEFAULT 0,
  reserved_usd    double precision NOT NULL DEFAULT 0, -- outstanding reservation held by this generation
  ms_text         int,
  ms_image        int
);
CREATE INDEX IF NOT EXISTS generations_slot_created_idx ON generations (slot, created_at DESC);
CREATE INDEX IF NOT EXISTS generations_inflight_idx ON generations (status, stage_at) WHERE status IN ('asking','generating');
-- At most one generation in flight per team; enforced atomically by the database.
CREATE UNIQUE INDEX IF NOT EXISTS generations_one_inflight_per_team ON generations (slot) WHERE status IN ('asking','questions','generating');

CREATE TABLE IF NOT EXISTS assignments (
  voter_slot      int NOT NULL REFERENCES teams(slot) ON DELETE CASCADE,
  target_slot     int NOT NULL REFERENCES teams(slot) ON DELETE CASCADE,
  generation_id   text NOT NULL,
  position        int NOT NULL DEFAULT 0,
  PRIMARY KEY (voter_slot, target_slot)
);
CREATE INDEX IF NOT EXISTS assignments_target_idx ON assignments (target_slot);

CREATE TABLE IF NOT EXISTS votes (
  voter_slot      int NOT NULL REFERENCES teams(slot) ON DELETE CASCADE,
  target_slot     int NOT NULL REFERENCES teams(slot) ON DELETE CASCADE,
  level           int NOT NULL CHECK (level BETWEEN 1 AND 5),
  enemy           int NOT NULL CHECK (enemy BETWEEN 1 AND 5),
  ability         int NOT NULL CHECK (ability BETWEEN 1 AND 5),
  puzzle          int NOT NULL CHECK (puzzle BETWEEN 1 AND 5),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (voter_slot, target_slot)
);
CREATE INDEX IF NOT EXISTS votes_target_idx ON votes (target_slot);

CREATE TABLE IF NOT EXISTS feed (
  id              bigserial PRIMARY KEY,
  ts              timestamptz NOT NULL DEFAULT now(),
  type            text NOT NULL,
  slot            int,
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- Failed login/join attempts, for per-IP rate limiting.
CREATE TABLE IF NOT EXISTS join_attempts (
  id              bigserial PRIMARY KEY,
  ip              text NOT NULL,
  kind            text NOT NULL DEFAULT 'team',
  ts              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS join_attempts_ip_ts_idx ON join_attempts (ip, kind, ts);

-- Added 2026-11-05: per-call cost breakdown for each generation (followup / prompt / image,
-- each {usd, ...token counts}), so spend can be audited after the fact.
ALTER TABLE generations ADD COLUMN IF NOT EXISTS cost_detail jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Added 2026-11-05: Reset event saves a full JSON snapshot of the event here before wiping it,
-- so logs (teams, generations, feed, votes) survive a reset. Images are still deleted from Blob.
CREATE TABLE IF NOT EXISTS event_archive (
  id              bigserial PRIMARY KEY,
  archived_at     timestamptz NOT NULL DEFAULT now(),
  epoch           int NOT NULL,
  snapshot        jsonb NOT NULL
);

-- Added 2026-11-06: paused countdown. While paused, phase_ends_at is NULL and this holds the
-- milliseconds that were left; Resume sets phase_ends_at = now() + this.
ALTER TABLE event_state ADD COLUMN IF NOT EXISTS timer_paused_ms int;

-- Added 2026-11-06: game sessions. One row per game; id = event_state.epoch while that game was live.
-- "Start new game" fills the old row's snapshot (teams, generations with image links, feed, votes,
-- assignments, event state incl. ranking) and ended_at, then empties the live tables. Nothing is
-- deleted from Blob: each game's images live under ev<id>/, so every snapshot's links keep working.
CREATE TABLE IF NOT EXISTS game_sessions (
  id                int PRIMARY KEY,
  started_at        timestamptz NOT NULL DEFAULT now(),
  ended_at          timestamptz,
  snapshot          jsonb,
  team_count        int,
  generation_count  int,
  submission_count  int,
  spend_usd         double precision
);

-- The game that is live right now gets its row up front.
INSERT INTO game_sessions (id) SELECT epoch FROM event_state WHERE id = 1 ON CONFLICT (id) DO NOTHING;

-- Earlier resets saved snapshots into event_archive; carry them over as past games.
INSERT INTO game_sessions (id, started_at, ended_at, snapshot, team_count, generation_count, submission_count, spend_usd)
SELECT a.epoch,
       COALESCE((a.snapshot->'feed'->0->>'ts')::timestamptz, a.archived_at),
       a.archived_at,
       a.snapshot,
       jsonb_array_length(COALESCE(a.snapshot->'teams', '[]'::jsonb)),
       jsonb_array_length(COALESCE(a.snapshot->'generations', '[]'::jsonb)),
       (SELECT count(*) FROM jsonb_array_elements(COALESCE(a.snapshot->'teams', '[]'::jsonb)) t WHERE t->>'submitted_generation_id' IS NOT NULL),
       (SELECT COALESCE(sum((t->>'spend_usd')::float8), 0) FROM jsonb_array_elements(COALESCE(a.snapshot->'teams', '[]'::jsonb)) t)
  FROM event_archive a
ON CONFLICT (id) DO NOTHING;

-- Added 2026-11-07: server copy of each team's unsent design form (autosaved while typing), so a
-- reload, logout, team switch or another device never loses it. {fields, refs}; last write wins.
ALTER TABLE teams ADD COLUMN IF NOT EXISTS draft jsonb;
ALTER TABLE teams ADD COLUMN IF NOT EXISTS draft_updated_at timestamptz;
-- Partly-scored designs during VOTING ({generation id: {level, enemy, ability, puzzle}} with nulls), so a
-- reload or device switch keeps taps that don't yet form a full vote. Full votes still go to votes.
ALTER TABLE teams ADD COLUMN IF NOT EXISTS vote_draft jsonb;
