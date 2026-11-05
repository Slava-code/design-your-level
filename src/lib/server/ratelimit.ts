// Per-IP limits on FAILED join / admin-login attempts (successful logins never count, so a class
// sharing one NAT address can all join). Codes are long random words, so this only stops guessing.
// Only failures are stored; the count is read before the comparison, so a parallel burst can exceed the
// per-minute limit by its own size once (harmless: each guess is a constant-time compare).
import "server-only";
import { q, q1 } from "./db";
import { ApiErr } from "./http";
import { rateLimits } from "./config";

type Kind = "team" | "admin";

type Counts = { perMin: number; perHour: number; retry: number };

async function counts(ip: string, kind: Kind): Promise<Counts> {
  const row = await q1<{ min: string; hour: string; oldest_min: Date | null }>(
    `SELECT count(*) FILTER (WHERE ts > now() - interval '1 minute') AS min,
            count(*) AS hour,
            min(ts) FILTER (WHERE ts > now() - interval '1 minute') AS oldest_min
       FROM join_attempts WHERE ip = $1 AND kind = $2 AND ts > now() - interval '1 hour'`,
    [ip, kind],
  );
  const retry = row?.oldest_min ? Math.max(1, Math.ceil((new Date(row.oldest_min).getTime() + 60_000 - Date.now()) / 1000)) : 60;
  return { perMin: Number(row?.min ?? 0), perHour: Number(row?.hour ?? 0), retry };
}

const tooMany = (retry: number) => new ApiErr("rate_limited", `Too many wrong codes from this network. Try again in ${retry} seconds.`, retry);

/**
 * Call before checking the code. Returns a function to call AFTER the comparison with whether the code
 * was right. Team joins: a correct code is let in unless the network is far over the limit (3x the
 * per-minute limit, i.e. a scripted burst), so a classroom sharing one NAT address can't lock real
 * teams out with typos; the hourly limit only blocks wrong codes. Admin login: the limit applies to
 * every attempt.
 */
export async function rateLimitGate(ip: string, kind: Kind): Promise<(codeOk: boolean) => Promise<void>> {
  const lim = rateLimits();
  const c = await counts(ip, kind);
  const minLimit = kind === "team" ? lim.teamPerMin : lim.adminPerMin;
  const hardLimit = kind === "team" ? minLimit * 3 : minLimit;
  if (c.perMin >= hardLimit) throw tooMany(c.retry);
  return async (codeOk: boolean) => {
    if (codeOk) return;
    await recordFailedAttempt(ip, kind);
    if (c.perMin >= minLimit) throw tooMany(c.retry);
    if (kind === "team" && c.perHour >= lim.teamPerHour) {
      throw new ApiErr("rate_limited", "Too many wrong codes from this network. Wait a few minutes or ask the presenter for help.", 600);
    }
  };
}

export async function recordFailedAttempt(ip: string, kind: Kind): Promise<void> {
  await q("INSERT INTO join_attempts (ip, kind) VALUES ($1, $2)", [ip, kind]);
  // Opportunistic cleanup.
  if (Math.random() < 0.05) await q("DELETE FROM join_attempts WHERE ts < now() - interval '1 day'");
}
