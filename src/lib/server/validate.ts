// Input validation for API bodies. Throws ApiErr("bad_request") with a human-readable message.
import "server-only";
import {
  DESIGN_FIELD_MAX,
  MAX_REFS,
  REF_FIELDS,
  SCORE_KEYS,
  type DesignFields,
  type RefField,
  type RefImage,
  type Scores,
} from "@/lib/types";
import { ApiErr } from "./http";
import { blobHost } from "./config";

const bad = (m: string) => new ApiErr("bad_request", m);

/** Strip control characters (keep newlines/tabs), trim. */
export function cleanText(v: unknown, max: number, label: string): string {
  if (v == null) return "";
  if (typeof v !== "string") throw bad(`${label} must be text.`);
  const s = v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").replace(/\r\n?/g, "\n").trim();
  if (s.length > max) throw bad(`${label} is too long (max ${max} characters).`);
  return s;
}

const LABELS: Record<keyof DesignFields, string> = {
  genre: "Genre",
  feeling: "Feeling",
  artStyle: "Art style",
  level: "Level",
  enemy: "Enemy",
  ability: "Ability",
  puzzle: "Puzzle",
};

export function parseDesign(v: unknown): DesignFields {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw bad("design must be an object.");
  const o = v as Record<string, unknown>;
  const out = {} as DesignFields;
  for (const k of Object.keys(DESIGN_FIELD_MAX) as (keyof DesignFields)[]) {
    out[k] = cleanText(o[k], DESIGN_FIELD_MAX[k], LABELS[k]);
  }
  if (!Object.values(out).some(Boolean)) throw bad("Fill in at least one part of the design first.");
  return out;
}

/** Validates reference URLs: our Blob store's public host, and the team's upload prefix. */
export function parseRefs(v: unknown, uploadPrefix: string): RefImage[] {
  if (v == null) return [];
  if (!Array.isArray(v)) throw bad("references must be an array.");
  if (v.length > MAX_REFS) throw bad(`At most ${MAX_REFS} reference images per generation.`);
  const host = blobHost();
  return v.map((r, i) => {
    if (!r || typeof r !== "object") throw bad(`Reference ${i + 1} is invalid.`);
    const { url, field } = r as { url?: unknown; field?: unknown };
    if (typeof field !== "string" || !REF_FIELDS.includes(field as RefField)) throw bad(`Reference ${i + 1} has an unknown field.`);
    let u: URL;
    try {
      u = new URL(String(url));
    } catch {
      throw bad(`Reference ${i + 1} has an invalid URL.`);
    }
    const hostOk = host ? u.hostname === host : u.hostname.endsWith(".public.blob.vercel-storage.com");
    if (u.protocol !== "https:" || !hostOk || !decodeURIComponent(u.pathname).startsWith("/" + uploadPrefix)) {
      throw bad(`Reference ${i + 1} was not uploaded through this app. Upload it again.`);
    }
    return { url: u.toString(), field: field as RefField };
  });
}

/** 1-32 chars after trimming and collapsing whitespace. */
export function parseTeamName(v: unknown): string {
  if (typeof v !== "string") throw bad("name must be text.");
  const s = v.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
  if (s.length < 1) throw bad("Team name can't be empty.");
  if (s.length > 32) throw bad("Team name is too long (max 32 characters).");
  return s;
}

export function parseScores(v: unknown): Scores {
  if (!v || typeof v !== "object") throw bad("scores must be an object.");
  const o = v as Record<string, unknown>;
  const out = {} as Scores;
  for (const k of SCORE_KEYS) {
    const n = o[k];
    if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > 5) throw bad(`Score "${k}" must be a whole number from 1 to 5.`);
    out[k] = n;
  }
  return out;
}

export function parseAnswers(v: unknown, count: number): string[] {
  if (!Array.isArray(v)) throw bad("answers must be an array of strings.");
  if (v.length > count) throw bad("Too many answers.");
  const out: string[] = [];
  for (let i = 0; i < count; i++) out.push(cleanText(v[i] ?? "", 500, `Answer ${i + 1}`));
  return out;
}
