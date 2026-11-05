// Signed httpOnly session cookies (HMAC-SHA256 with SESSION_SECRET).
// Two independent cookies so one browser can be admin and a team at once:
//   dyl_team  = {k:"t", slot, epoch, iat}
//   dyl_admin = {k:"a", epoch, iat}
// A session is valid only while its epoch equals event_state.epoch (Reset event bumps it).
import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { sessionSecret, isProd, slotCount } from "./config";

export const TEAM_COOKIE = "dyl_team";
export const ADMIN_COOKIE = "dyl_admin";
const MAX_AGE_SEC = 3 * 24 * 3600;

type TeamPayload = { k: "t"; slot: number; epoch: number; iat: number };
type AdminPayload = { k: "a"; epoch: number; iat: number };

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");
const sign = (data: string) => createHmac("sha256", sessionSecret()).update("dyl.v1." + data).digest();

function encode(payload: object): string {
  const data = b64(JSON.stringify(payload));
  return `${data}.${b64(sign(data))}`;
}

function decode<T>(value: string | undefined): T | null {
  if (!value) return null;
  const [data, sig] = value.split(".");
  if (!data || !sig) return null;
  const expected = sign(data);
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const p = JSON.parse(Buffer.from(data, "base64url").toString("utf8"));
    if (typeof p?.iat !== "number" || Date.now() - p.iat > MAX_AGE_SEC * 1000) return null;
    return p as T;
  } catch {
    return null;
  }
}

const cookieOpts = () => ({
  httpOnly: true,
  sameSite: "lax" as const,
  secure: isProd(),
  path: "/",
  maxAge: MAX_AGE_SEC,
});

export async function setTeamCookie(slot: number, epoch: number) {
  (await cookies()).set(TEAM_COOKIE, encode({ k: "t", slot, epoch, iat: Date.now() } satisfies TeamPayload), cookieOpts());
}
export async function setAdminCookie(epoch: number) {
  (await cookies()).set(ADMIN_COOKIE, encode({ k: "a", epoch, iat: Date.now() } satisfies AdminPayload), cookieOpts());
}
export async function clearTeamCookie() {
  (await cookies()).set(TEAM_COOKIE, "", { ...cookieOpts(), maxAge: 0 });
}
export async function clearAdminCookie() {
  (await cookies()).set(ADMIN_COOKIE, "", { ...cookieOpts(), maxAge: 0 });
}

export type CookieRead<T> = { present: boolean; session: T | null };

/** Signature-checked team session (epoch NOT yet checked). */
export async function readTeamCookie(): Promise<CookieRead<{ slot: number; epoch: number }>> {
  const raw = (await cookies()).get(TEAM_COOKIE)?.value;
  const p = decode<TeamPayload>(raw);
  const ok = p && p.k === "t" && Number.isInteger(p.slot) && p.slot >= 1 && p.slot <= slotCount() && Number.isInteger(p.epoch);
  return { present: !!raw, session: ok ? { slot: p!.slot, epoch: p!.epoch } : null };
}

/** Signature-checked admin session (epoch NOT yet checked). */
export async function readAdminCookie(): Promise<CookieRead<{ epoch: number }>> {
  const raw = (await cookies()).get(ADMIN_COOKIE)?.value;
  const p = decode<AdminPayload>(raw);
  const ok = p && p.k === "a" && Number.isInteger(p.epoch);
  return { present: !!raw, session: ok ? { epoch: p!.epoch } : null };
}
