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
