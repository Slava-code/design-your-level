// Event state (singleton row) and session enforcement against the current epoch.
import "server-only";
import type { Phase } from "@/lib/types";
import { q1, type Row } from "./db";
import { ApiErr } from "./http";
import { readAdminCookie, readTeamCookie } from "./session";

export type EventRow = {
  phase: Phase;
  phase_started_at: Date;
  phase_ends_at: Date | null;
  epoch: number;
  reveal_step: number;
  voting_frozen_at: Date | null;
  ranking: unknown;
  now: Date;
};

export const EVENT_SQL = "SELECT phase, phase_started_at, phase_ends_at, epoch, reveal_step, voting_frozen_at, ranking, now() AS now FROM event_state WHERE id = 1";

export async function getEvent(): Promise<EventRow> {
  const row = await q1<Row>(EVENT_SQL);
  if (!row) throw new ApiErr("server", "Event state missing: run scripts/migrate.mjs.");
  return row as EventRow;
}

/** Valid team session for the current epoch, or throws unauthorized. */
export async function requireTeam(): Promise<{ slot: number; event: EventRow }> {
  const [{ session }, event] = await Promise.all([readTeamCookie(), getEvent()]);
  if (!session || session.epoch !== event.epoch) {
    throw new ApiErr("unauthorized", "Your session has ended. Join again with your team code.");
  }
  return { slot: session.slot, event };
}

/** Valid admin session for the current epoch, or throws unauthorized. */
export async function requireAdmin(): Promise<{ event: EventRow }> {
  const [{ session }, event] = await Promise.all([readAdminCookie(), getEvent()]);
  if (!session || session.epoch !== event.epoch) throw new ApiErr("unauthorized", "Admin login required.");
  return { event };
}

export function requirePhase(event: EventRow, allowed: Phase[], what: string) {
  if (!allowed.includes(event.phase)) {
    throw new ApiErr("phase", `${what} is not available during ${event.phase.toLowerCase()}.`);
  }
}
