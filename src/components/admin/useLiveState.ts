"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AdminState, AnonState, FeedItem, StateResponse } from "@/lib/types";

const POLL_MS = 2000;
const MAX_BACKOFF_MS = 8000;
const FEED_CAP = 600;

export type LiveStatus = "loading" | "ok" | "anon";

export type LiveState = {
  status: LiveStatus;
  /** Latest admin/screen snapshot (kept on transient errors). */
  state: AdminState | null;
  anon: AnonState | null;
  /** serverNow - clientNow (ms). Pass to <Timer serverOffsetMs>. */
  offsetMs: number;
  /** Accumulated feed (ascending by id). Cleared when the event epoch changes. */
  feed: FeedItem[];
  /** Consecutive failed polls (0 = healthy). */
  failures: number;
  lastOkAt: number | null;
  /** Poll right now (e.g. after an action). */
  refresh: () => void;
};

/**
 * Polls GET /api/state?view=admin|screen every 2 s while the tab is visible.
 * Incremental feed via ?since=feedCursor; backs off on errors and keeps the last good state.
 */
export function useLiveState(view: "admin" | "screen"): LiveState {
  const [status, setStatus] = useState<LiveStatus>("loading");
  const [state, setState] = useState<AdminState | null>(null);
  const [anon, setAnon] = useState<AnonState | null>(null);
  const [offsetMs, setOffsetMs] = useState(0);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [failures, setFailures] = useState(0);
  const [lastOkAt, setLastOkAt] = useState<number | null>(null);

  const cursor = useRef<number | null>(null);
  const epoch = useRef<number | null>(null);
  const timer = useRef<number | null>(null);
  const inFlight = useRef(false);
  const fails = useRef(0);
  const alive = useRef(true);
  const pollRef = useRef<() => void>(() => {});

  const schedule = useCallback((ms: number) => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => pollRef.current(), ms);
  }, []);

  const poll = useCallback(async () => {
    if (!alive.current) return;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return; // resumes on visibilitychange
    if (inFlight.current) return;
    inFlight.current = true;
    const ctrl = new AbortController();
    const abort = window.setTimeout(() => ctrl.abort(), 9000);
    try {
      const qs = new URLSearchParams({ view });
      if (cursor.current != null) qs.set("since", String(cursor.current));
      const sentAt = Date.now();
      const res = await fetch(`/api/state?${qs}`, { cache: "no-store", credentials: "same-origin", signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as StateResponse;
      const receivedAt = Date.now();
      if (!alive.current) return;
      // Offset against the midpoint of the request, which halves the latency error.
      setOffsetMs(Date.parse(data.serverNow) - (sentAt + receivedAt) / 2);
      fails.current = 0;
      setFailures(0);
      setLastOkAt(receivedAt);
      if (data.role === "admin" || data.role === "screen") {
        if (epoch.current !== null && epoch.current !== data.epoch) {
          // Event was reset: drop the old feed and re-read the latest items.
          epoch.current = data.epoch;
          cursor.current = null;
          setFeed([]);
          setState(data);
          setStatus("ok");
          inFlight.current = false;
          schedule(0);
          return;
        }
        epoch.current = data.epoch;
        const incremental = cursor.current != null;
        cursor.current = data.feedCursor;
        if (data.feed.length || !incremental) {
          setFeed((prev) => {
            const base = incremental ? prev : [];
            const seen = new Set(base.map((f) => f.id));
            const merged = base.concat(data.feed.filter((f) => !seen.has(f.id)));
            return merged.length > FEED_CAP ? merged.slice(merged.length - FEED_CAP) : merged;
          });
        }
        setState(data);
        setAnon(null);
        setStatus("ok");
      } else {
        cursor.current = null;
        epoch.current = null;
        setAnon(data as AnonState);
        setState(null);
        setFeed([]);
        setStatus("anon");
      }
      schedule(POLL_MS);
    } catch {
      if (!alive.current) return;
      fails.current += 1;
      setFailures(fails.current);
      schedule(Math.min(MAX_BACKOFF_MS, POLL_MS * 2 ** Math.min(3, fails.current - 1)));
    } finally {
      window.clearTimeout(abort);
      inFlight.current = false;
    }
  }, [view, schedule]);

  useEffect(() => {
    pollRef.current = () => void poll();
  }, [poll]);

  useEffect(() => {
    alive.current = true;
    void poll();
    const onVis = () => {
      if (document.visibilityState === "visible") schedule(0);
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);
    window.addEventListener("online", onVis);
    return () => {
      alive.current = false;
      if (timer.current) window.clearTimeout(timer.current);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onVis);
      window.removeEventListener("online", onVis);
    };
  }, [poll, schedule]);

  const refresh = useCallback(() => {
    if (inFlight.current) {
      // Let the current request finish, then poll again quickly.
      schedule(250);
    } else schedule(0);
  }, [schedule]);

  return { status, state, anon, offsetMs, feed, failures, lastOkAt, refresh };
}

/** Re-render every `ms` (for relative times / countdown-derived UI). */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
}
