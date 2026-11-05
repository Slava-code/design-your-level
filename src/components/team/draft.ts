"use client";

// Design draft model + localStorage autosave (keyed per event epoch + team slot),
// so a refresh, phone lock or tab crash never loses the team's work.
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

function read(key: string): Draft | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<Draft>;
    const fields = { ...EMPTY_FIELDS };
    for (const k of Object.keys(EMPTY_FIELDS) as (keyof DesignFields)[]) {
      const v = d.fields?.[k];
      if (typeof v === "string") fields[k] = v;
    }
    const refs = Array.isArray(d.refs)
      ? d.refs.filter((r): r is DraftRef => !!r && typeof r.url === "string" && typeof r.field === "string" && typeof r.id === "string")
      : [];
    return { fields, refs };
  } catch {
    return null;
  }
}

/** Remove drafts from older epochs / other slots on this device. */
function prune(keep: string) {
  try {
    for (let i = window.localStorage.length - 1; i >= 0; i--) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith("dyl:draft:") && k !== keep) window.localStorage.removeItem(k);
    }
  } catch {
    /* ignore */
  }
}

export function useDraft(epoch: number, slot: number) {
  const key = keyFor(epoch, slot);
  const [draft, setDraft] = useState<Draft>({ fields: EMPTY_FIELDS, refs: [] });
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const saveTimer = useRef<number | null>(null);

  // Load once per key.
  useEffect(() => {
    const d = read(key);
    setDraft(d ?? { fields: EMPTY_FIELDS, refs: [] });
    setLoadedKey(key);
    prune(key);
  }, [key]);

  // Debounced save after load.
  useEffect(() => {
    if (loadedKey !== key) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      try {
        window.localStorage.setItem(key, JSON.stringify(draft));
      } catch {
        /* storage full / private mode: nothing to do */
      }
    }, 250);
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, [draft, key, loadedKey]);

  // Flush immediately when the page is hidden (phone lock, tab switch).
  useEffect(() => {
    const flush = () => {
      if (loadedKey !== key) return;
      try {
        window.localStorage.setItem(key, JSON.stringify(draft));
      } catch {
        /* ignore */
      }
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", flush);
    };
  }, [draft, key, loadedKey]);

  const setField = useCallback((k: keyof DesignFields, v: string) => {
    setDraft((d) => ({ ...d, fields: { ...d.fields, [k]: v } }));
  }, []);

  return { draft, setDraft, setField, loaded: loadedKey === key };
}
