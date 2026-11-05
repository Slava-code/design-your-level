// Neon serverless (HTTP) database helper.
// Non-production (or DEV_DB_NAME set) swaps the database name in DATABASE_URL so tests never hit production.
import "server-only";
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { dbName } from "./config";

type Sql = NeonQueryFunction<false, false>;
let cached: Sql | null = null;

export function sql(): Sql {
  if (!cached) {
    const raw = process.env.DATABASE_URL;
    if (!raw) throw new Error("DATABASE_URL not set");
    const u = new URL(raw);
    u.pathname = "/" + dbName();
    cached = neon(u.toString());
  }
  return cached;
}

export type Row = Record<string, any>;

/** A dropped connection to Neon ("fetch failed", "Error connecting to database"), not a SQL error. */
function isConnectionError(e: unknown): boolean {
  const msg = e instanceof Error ? `${e.message} ${(e as { cause?: unknown }).cause ?? ""}` : String(e);
  return !(e as { code?: string })?.code && /fetch failed|error connecting to database|ECONNRESET|ETIMEDOUT|socket hang up|network/i.test(msg);
}

/** Retries a read once after a short pause if the connection blipped. Only for side-effect-free work. */
async function retryRead<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (!isConnectionError(e)) throw e;
    console.warn("[db] connection blip on a read, retrying once");
    await new Promise((r) => setTimeout(r, 300));
    return fn();
  }
}

const isPlainSelect = (text: string) => /^\s*SELECT\b/i.test(text) && !/\bFOR\s+(UPDATE|SHARE|NO KEY|KEY)\b/i.test(text);

/** Run one parameterised query ($1, $2, ...) and return its rows. Plain SELECTs retry once on a connection blip. */
export async function q<T extends Row = Row>(text: string, params: unknown[] = []): Promise<T[]> {
  const run = async () => (await sql().query(text, params)) as T[];
  return isPlainSelect(text) ? retryRead(run) : run();
}

export async function q1<T extends Row = Row>(text: string, params: unknown[] = []): Promise<T | null> {
  const rows = await q<T>(text, params);
  return rows[0] ?? null;
}

/** Several queries in one HTTP round trip, as one non-interactive transaction. Returns each query's rows. */
export async function batch(queries: [string, unknown[]][], opts?: { readOnly?: boolean }): Promise<Row[][]> {
  const s = sql();
  const run = async () =>
    (await s.transaction(
      queries.map(([text, params]) => s.query(text, params)),
      opts?.readOnly ? { readOnly: true } : undefined,
    )) as Row[][];
  // Read-only batches (the 2-second /api/state polls) retry once on a connection blip.
  return opts?.readOnly ? retryRead(run) : run();
}

/** Postgres unique-violation check. */
export function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "23505";
}

export const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());
export const isoOrNull = (v: unknown): string | null => (v == null ? null : iso(v));
export const num = (v: unknown): number => (v == null ? 0 : Number(v));
