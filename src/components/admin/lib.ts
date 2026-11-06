// Client helpers shared by /admin and /screen: API calls, formatting, phase metadata.
import type { ApiError, ErrorCode, FeedItem, Phase, TeamActivity } from "@/lib/types";
import type { Status } from "@/components/ui";

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string; code: ErrorCode | "network"; status: number };

/** JSON request to our own API. Never throws; network failures come back as code "network". */
export async function api<T>(path: string, body?: unknown, method: "GET" | "POST" = body === undefined ? "GET" : "POST"): Promise<ApiResult<T>> {
  const ctrl = new AbortController();
  const t = window.setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(path, {
      method,
      headers: body !== undefined ? { "content-type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: "no-store",
      credentials: "same-origin",
      signal: ctrl.signal,
    });
    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    if (!res.ok) {
      const e = (data ?? {}) as Partial<ApiError>;
      return {
        ok: false,
        status: res.status,
        code: (e.code as ErrorCode) ?? "server",
        error: typeof e.error === "string" ? e.error : `Request failed (${res.status}).`,
      };
    }
    return { ok: true, data: data as T };
  } catch {
    return { ok: false, status: 0, code: "network", error: "Could not reach the server. Check the connection and try again." };
  } finally {
    window.clearTimeout(t);
  }
}

export const usd = (n: number | null | undefined, digits = 2) =>
  n == null || !Number.isFinite(n) ? "--" : `$${n.toFixed(digits)}`;

/** Seconds -> "m:ss". */
export function mmss(totalSec: number): string {
  const s = Math.max(0, Math.round(totalSec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Parse "8", "8:00", "7:30", "90s" into seconds. Returns null if unparseable. */
export function parseDuration(raw: string): number | null {
  const v = raw.trim().toLowerCase();
  if (!v) return null;
  let m: RegExpMatchArray | null;
  if ((m = v.match(/^(\d{1,3}):(\d{1,2})$/))) return Number(m[1]) * 60 + Number(m[2]);
  if ((m = v.match(/^(\d{1,5})\s*s(ec)?$/))) return Number(m[1]);
  if ((m = v.match(/^(\d{1,3}(?:\.\d+)?)\s*(m|min)?$/))) return Math.round(Number(m[1]) * 60);
  return null;
}

export function ago(iso: string | null | undefined, nowMs: number): string {
  if (!iso) return "--";
  const d = Math.max(0, Math.round((nowMs - Date.parse(iso)) / 1000));
  if (d < 5) return "just now";
  if (d < 60) return `${d}s ago`;
  const m = Math.floor(d / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function clock(iso: string | null | undefined): string {
  if (!iso) return "--";
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
}

export function secs(ms: number | null | undefined): string {
  if (ms == null) return "--";
  return `${(ms / 1000).toFixed(1)}s`;
}

export const PHASE_LABEL: Record<Phase, string> = {
  LOBBY: "Lobby",
  DESIGN: "Design",
  VOTING: "Voting",
  REVEAL: "Reveal",
  CLOSED: "Closed",
};

export const PHASE_HINT: Record<Phase, string> = {
  LOBBY: "Teams join with their code cards and pick a name.",
  DESIGN: "Teams fill in the design, answer follow-ups, generate and submit.",
  VOTING: "Submissions are frozen. Each team rates up to 4 other designs.",
  REVEAL: "The podium is revealed on the projector, 3rd to 1st.",
  CLOSED: "Thanks screen with every submitted storyboard.",
};

/** Default timer (seconds) when entering each phase. 0 = no timer. */
export const DEFAULT_DURATION: Record<Phase, number> = {
  LOBBY: 0,
  DESIGN: 15 * 60,
  VOTING: 4 * 60,
  REVEAL: 0,
  CLOSED: 0,
};

/** Map a team's activity onto the shared StatusPill. `drawing` wording is friendlier on the projector. */
export function activityPill(a: TeamActivity, audience: "admin" | "screen" = "admin"): { status: Status; label: string } {
  switch (a) {
    case "drafting":
      return { status: "drafting", label: "Drafting" };
    case "asking":
      return { status: "asking", label: audience === "screen" ? "Thinking" : "Asking" };
    case "answering":
      return { status: "asking", label: "Answering" };
    case "generating":
      return { status: "generating", label: audience === "screen" ? "Drawing" : "Generating" };
    case "submitted":
      return { status: "submitted", label: "Submitted" };
    default:
      return { status: "idle", label: "Idle" };
  }
}

const num = (v: unknown) => (typeof v === "number" ? v : Number(v));

export type FeedTone = "info" | "good" | "warn" | "bad" | "admin";

/** Human sentence + tone for a feed item. Team identity is prepended by the caller. */
export function describeFeed(f: FeedItem): { text: string; tone: FeedTone; tag: string } {
  const p = f.payload ?? {};
  switch (f.type) {
    case "joined":
      return { text: p.rejoin ? "rejoined (another device or a refresh)" : "joined", tone: "good", tag: "JOIN" };
    case "renamed":
      return {
        text: `renamed ${p.from ? `"${String(p.from)}" ` : ""}to "${String(p.to ?? "")}"`,
        tone: "info",
        tag: "NAME",
      };
    case "asked": {
      const n = num(p.count);
      return {
        text: n > 0 ? `got ${n} follow-up question${n === 1 ? "" : "s"}` : "needed no follow-up questions",
        tone: "info",
        tag: "ASK",
      };
    }
    case "generated":
      return { text: `got a storyboard (${usd(num(p.costUsd), 3)})`, tone: "good", tag: "DRAW" };
    case "refused":
      return { text: `had an image refused by the model (${usd(num(p.costUsd), 3)} charged)`, tone: "warn", tag: "REFUSED" };
    case "error":
      return { text: `generation failed: ${String(p.message ?? "unknown error")}`, tone: "bad", tag: "ERROR" };
    case "flagged": {
      const cats = Array.isArray(p.categories) ? (p.categories as unknown[]).map(String).join(", ") : "";
      return { text: `text flagged by moderation${cats ? ` (${cats})` : ""}, nothing charged`, tone: "warn", tag: "FLAGGED" };
    }
    case "cancelled":
      return { text: "skipped the follow-up round (cancelled)", tone: "info", tag: "CANCEL" };
    case "submitted":
      return { text: p.resubmit ? "resubmitted a different storyboard" : "submitted a storyboard", tone: "good", tag: "SUBMIT" };
    case "voted":
      return { text: `rated Team ${String(p.target ?? "?")}'s design`, tone: "info", tag: "VOTE" };
    case "phase": {
      const d = num(p.durationSec);
      return {
        text: `Phase ${String(p.from ?? "?")} -> ${String(p.to ?? "?")}${d > 0 ? ` (${mmss(d)} timer)` : ""}`,
        tone: "admin",
        tag: "PHASE",
      };
    }
    case "timer": {
      if (p.setSec != null) {
        const s = num(p.setSec);
        return { text: s > 0 ? `Timer set to ${mmss(s)}` : "Timer cleared", tone: "admin", tag: "TIMER" };
      }
      const a = num(p.addSec);
      return { text: `Timer ${a >= 0 ? "+" : "-"}${mmss(Math.abs(a))}`, tone: "admin", tag: "TIMER" };
    }
    case "reveal":
      return { text: `Podium reveal step ${String(p.step ?? "?")}`, tone: "admin", tag: "REVEAL" };
    case "budget_reset":
      return { text: "had its budget reset by the admin", tone: "admin", tag: "BUDGET" };
    case "budget_set":
      return { text: `budget set to ${usd(num(p.budgetUsd))} (dev)`, tone: "admin", tag: "BUDGET" };
    case "event_reset":
      return { text: "Event reset", tone: "admin", tag: "RESET" };
    default:
      return { text: String(f.type), tone: "info", tag: "EVENT" };
  }
}

export const teamLabel = (slot: number, name?: string | null) =>
  name && name.trim() && name.trim() !== `Team ${slot}` ? `${name} (Team ${slot})` : `Team ${slot}`;
