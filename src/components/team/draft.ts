"use client";

// Design draft model + autosave (localStorage per device, plus a server copy per team),
// so a refresh, phone lock, tab crash, logout or switch of device never loses the team's work.
import { useCallback, useEffect, useRef, useState } from "react";
import type { DesignFields, RefField } from "@/lib/types";

export type DraftRef = { id: string; url: string; field: RefField; name?: string };
export type Draft = { fields: DesignFields; refs: DraftRef[] };

export const EMPTY_FIELDS: DesignFields = {
  genre: "",
  feeling: "",
  artStyle: "",
  level: "",
  enemy: "",
  ability: "",
  puzzle: "",
};

export const REQUIRED: (keyof DesignFields)[] = ["feeling", "level", "enemy", "ability", "puzzle"];

export const FIELD_LABEL: Record<keyof DesignFields, string> = {
  genre: "Genre",
  feeling: "Feeling",
  artStyle: "Art style",
  level: "Level",
  enemy: "Enemy",
  ability: "Ability",
  puzzle: "Puzzle",
};

export function missingFields(f: DesignFields): (keyof DesignFields)[] {
  return REQUIRED.filter((k) => !f[k].trim());
}

const keyFor = (epoch: number, slot: number) => `dyl:draft:v1:ev${epoch}:slot${slot}`;
const EMPTY_DRAFT: Draft = { fields: EMPTY_FIELDS, refs: [] };

/** Coerces stored/received JSON into a Draft (unknown keys and bad refs dropped), or null. */
function normalize(raw: unknown): Draft | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Partial<Draft>;
  const fields = { ...EMPTY_FIELDS };
  for (const k of Object.keys(EMPTY_FIELDS) as (keyof DesignFields)[]) {
    const v = d.fields?.[k];
    if (typeof v === "string") fields[k] = v;
  }
  const refs = Array.isArray(d.refs)
    ? d.refs.filter((r): r is DraftRef => !!r && typeof r.url === "string" && typeof r.field === "string" && typeof r.id === "string")
    : [];
  return { fields, refs };
}

type Local = { draft: Draft; dirty: boolean };

function readLocal(key: string): Local | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { dirty?: unknown };
    const draft = normalize(parsed);
    // Drafts saved before server sync existed have no flag: treat them as unsent.
    return draft ? { draft, dirty: parsed.dirty !== false } : null;
  } catch {
    return null;
  }
}

function writeLocal(key: string, draft: Draft, dirty: boolean) {
  try {
    window.localStorage.setItem(key, JSON.stringify({ ...draft, dirty }));
  } catch {
    /* storage full / private mode: the server copy still works */
  }
}

/** Remove drafts from older games on this device (other teams' drafts in this game are kept). */
function prune(epoch: number) {
  const keep = `dyl:draft:v1:ev${epoch}:`;
  try {
    for (let i = window.localStorage.length - 1; i >= 0; i--) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith("dyl:draft:") && !k.startsWith(keep)) window.localStorage.removeItem(k);
    }
  } catch {
    /* ignore */
  }
}

/** The team's server copy: a Draft, null (none saved yet), or undefined (couldn't reach the server). */
async function fetchServer(): Promise<Draft | null | undefined> {
  const ctrl = new AbortController();
  const t = window.setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch("/api/team/draft", { cache: "no-store", credentials: "same-origin", signal: ctrl.signal });
    if (!res.ok) return undefined;
    const body = (await res.json()) as { draft?: unknown };
    return body.draft ? normalize(body.draft) : null;
  } catch {
    return undefined;
  } finally {
    window.clearTimeout(t);
  }
}

async function sendDraft(draft: Draft, keepalive = false): Promise<boolean> {
  try {
    const res = await fetch("/api/team/draft", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(draft),
      credentials: "same-origin",
      cache: "no-store",
      keepalive,
    });
    return res.ok;
  } catch {
    return false;
  }
}

// The mounted form registers here so a logout can push the last keystrokes first.
let flushHook: (() => Promise<void>) | null = null;
/** Sends any unsaved form changes to the server now (used before logging out). */
export async function flushDraft() {
  await flushHook?.();
}

/** "saved" = on the server; "saving" = waiting to send; "local" = server unreachable, kept on this device. */
export type SaveStatus = "loading" | "saving" | "saved" | "local";

const SEND_DELAY_MS = 800;
const RETRY_MS = 4000;

/**
 * The design form's state, autosaved twice: to localStorage on every change (instant, this device) and
 * to the server shortly after typing pauses (shared by the team's devices; survives logout, switching
 * teams, private mode). On load, unsent local edits win; otherwise the server copy is used.
 */
export function useDraft(epoch: number, slot: number) {
  const key = keyFor(epoch, slot);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [status, setStatus] = useState<SaveStatus>("loading");
  const [retryTick, setRetryTick] = useState(0);
  const synced = useRef<string | null>(null); // JSON of what the server holds; null = unknown
  const latest = useRef<Draft>(draft);
  useEffect(() => {
    latest.current = draft;
  }, [draft]);

  // Load once per key: local copy and server copy, then pick.
  useEffect(() => {
    let cancelled = false;
    setLoadedKey(null);
    setStatus("loading");
    const local = readLocal(key);
    prune(epoch);
    void fetchServer().then((server) => {
      if (cancelled) return;
      let pick: Draft;
      if (server === undefined) {
        synced.current = null;
        pick = local?.draft ?? EMPTY_DRAFT;
      } else {
        synced.current = JSON.stringify(server ?? EMPTY_DRAFT);
        pick = local?.dirty ? local.draft : (server ?? local?.draft ?? EMPTY_DRAFT);
      }
      latest.current = pick;
      setDraft(pick);
      setLoadedKey(key);
    });
    return () => {
      cancelled = true;
    };
  }, [key, epoch]);

  // Every change: write locally now, send to the server once typing pauses (retrying if offline).
  useEffect(() => {
    if (loadedKey !== key) return;
    const json = JSON.stringify(draft);
    const dirty = json !== synced.current;
    writeLocal(key, draft, dirty);
    if (!dirty) {
      setStatus("saved");
      return;
    }
    setStatus((st) => (st === "local" ? st : "saving"));
    let live = true;
    const t = window.setTimeout(async () => {
      const ok = await sendDraft(draft);
      if (!live) {
        if (ok) synced.current = json;
        return;
      }
      if (ok) {
        synced.current = json;
        writeLocal(key, draft, false);
        setStatus("saved");
      } else {
        setStatus("local");
        window.setTimeout(() => live && setRetryTick((n) => n + 1), RETRY_MS);
      }
    }, SEND_DELAY_MS);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [draft, key, loadedKey, retryTick]);

  // Page hidden (phone lock, tab switch, closing): send now, even if the page is going away.
  useEffect(() => {
    if (loadedKey !== key) return;
    const unsent = () => JSON.stringify(latest.current) !== synced.current;
    const onHide = () => {
      if (document.visibilityState === "hidden" && unsent()) void sendDraft(latest.current, true);
    };
    const onPageHide = () => {
      if (unsent()) void sendDraft(latest.current, true);
    };
    flushHook = async () => {
      if (!unsent()) return;
      const json = JSON.stringify(latest.current);
      if (await sendDraft(latest.current)) {
        synced.current = json;
        writeLocal(key, latest.current, false);
      }
    };
    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      flushHook = null;
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [key, loadedKey]);

  const setField = useCallback((k: keyof DesignFields, v: string) => {
    setDraft((d) => ({ ...d, fields: { ...d.fields, [k]: v } }));
  }, []);

  return { draft, setDraft, setField, loaded: loadedKey === key, saveStatus: status };
}
