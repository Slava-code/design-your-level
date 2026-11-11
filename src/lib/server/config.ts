// Server configuration parsed from env. Codes never leave this module except as slot numbers.
import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";

/** trim, lowercase, any run of whitespace/underscores/hyphens -> single hyphen. */
export function normalizeCode(raw: string): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s_\-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const digest = (s: string) => createHash("sha256").update(s, "utf8").digest();

let teamDigests: Buffer[] | null = null;
function getTeamDigests(): Buffer[] {
  if (!teamDigests) {
    teamDigests = (process.env.TEAM_CODES || "")
      .split(",")
      .map(normalizeCode)
      .filter(Boolean)
      .map(digest);
  }
  return teamDigests;
}

/** Number of team slots configured. */
export function slotCount(): number {
  return getTeamDigests().length;
}

/** Constant-time lookup: returns the 1-based slot for a team code, or null. Compares against every code. */
export function slotForCode(raw: string): number | null {
  const d = digest(normalizeCode(raw));
  let found = 0;
  getTeamDigests().forEach((t, i) => {
    if (timingSafeEqual(t, d)) found = found || i + 1;
  });
  return found || null;
}

export function isAdminCode(raw: string): boolean {
  const admin = normalizeCode(process.env.ADMIN_CODE || "");
  if (!admin) return false;
  return timingSafeEqual(digest(admin), digest(normalizeCode(raw)));
}

export function sessionSecret(): string {
  const s = process.env.SESSION_SECRET || "";
  if (s.length < 32) throw new Error("SESSION_SECRET missing or too short");
  return s;
}

export function teamBudgetUsd(): number {
  const n = Number(process.env.TEAM_BUDGET_USD);
  return Number.isFinite(n) && n > 0 ? n : 5;
}

const intEnv = (name: string, dflt: number) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : dflt;
};
export const rateLimits = () => ({
  // A whole classroom usually shares one public IP, so typos from a class add up. Codes are three random
  // words from a 4,438-word list (~87 billion combinations), so these limits make guessing impractical.
  teamPerMin: intEnv("JOIN_RATE_PER_MIN", 20),
  teamPerHour: intEnv("JOIN_RATE_PER_HOUR", 120),
  adminPerMin: intEnv("ADMIN_RATE_PER_MIN", 5),
});

export const isProd = () => process.env.NODE_ENV === "production";
/** Test-only routes (/api/dev/*): on in dev, or in a local production build when ALLOW_DEV_ROUTES=1 (e2e). Never set it on Vercel. */
export const devRoutesEnabled = () => !isProd() || (process.env.ALLOW_DEV_ROUTES === "1" && !process.env.VERCEL);

/** Database name actually used (see db.ts). */
export function dbName(): string {
  const url = process.env.DATABASE_URL || "";
  let base = "neondb";
  try {
    base = new URL(url).pathname.replace(/^\//, "") || base;
  } catch {}
  if (process.env.DEV_DB_NAME) return process.env.DEV_DB_NAME;
  // Vercel preview deployments also run with NODE_ENV=production; keep them off the live event's data.
  const production = isProd() && process.env.VERCEL_ENV !== "preview";
  return production ? base : "dyl_dev_backend";
}

/**
 * Blob namespace so dev databases never touch production blobs in the shared store.
 * "" when using the production database, "dev-<db>/" otherwise.
 */
export function blobNamespace(): string {
  const url = process.env.DATABASE_URL || "";
  let base = "neondb";
  try {
    base = new URL(url).pathname.replace(/^\//, "") || base;
  } catch {}
  const db = dbName();
  return db === base ? "" : `dev-${db}/`;
}

/** Public hostname of our Blob store, derived from the read-write token (vercel_blob_rw_<storeId>_...). */
export function blobHost(): string | null {
  const m = (process.env.BLOB_READ_WRITE_TOKEN || "").match(/^vercel_blob_rw_([A-Za-z0-9]+)_/);
  return m ? `${m[1].toLowerCase()}.public.blob.vercel-storage.com` : null;
}

/** Stuck-work timeout for asking/generating. */
export const STUCK_MS = 6 * 60 * 1000;
