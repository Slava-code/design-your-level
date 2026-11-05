"use client";

// Polls GET /api/state?view=team every 2 s while the tab is visible.
// - pauses while hidden, refreshes immediately when visible again
// - exponential backoff on network/5xx errors, with a `reconnecting` flag for a small indicator
// - computes serverOffsetMs (server clock - client clock) for timers
// - latest-request-wins, never overlapping requests
import { useCallback, useEffect, useRef, useState } from "react";
import type { StateResponse } from "@/lib/types";

const INTERVAL = 2000;
const MAX_BACKOFF = 15000;

export type TeamPoll = {
  state: StateResponse | null;
  /** Date.parse(serverNow) - local receive time, ms. */
  serverOffsetMs: number;
  /** True after a failed poll until the next success. */
  reconnecting: boolean;
  /** Fetch now (e.g. right after a mutation). */
  refresh: () => Promise<void>;
};

export function useTeamState(): TeamPoll {
  const [state, setState] = useState<StateResponse | null>(null);
  const [serverOffsetMs, setOffset] = useState(0);
  const [reconnecting, setReconnecting] = useState(false);
  const failures = useRef(0);
  const timer = useRef<number | null>(null);
  const inflight = useRef<Promise<void> | null>(null);
  const seq = useRef(0);
  const alive = useRef(true);

  const schedule = useCallback((ms: number) => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
    if (!alive.current || document.visibilityState === "hidden") return;
    timer.current = window.setTimeout(() => void tickRef.current(), ms);
  }, []);

  const tick = useCallback(async () => {
    if (inflight.current) return inflight.current;
    const my = ++seq.current;
    const run = (async () => {
      const ctrl = new AbortController();
      const kill = window.setTimeout(() => ctrl.abort(), 10000);
      try {
        const res = await fetch("/api/state?view=team", { cache: "no-store", credentials: "same-origin", signal: ctrl.signal });
        if (!res.ok && res.status >= 500) throw new Error(String(res.status));
        const json = (await res.json()) as StateResponse;
        if (!alive.current || my !== seq.current) return;
        const receivedAt = Date.now();
        const sn = Date.parse(json.serverNow);
        if (Number.isFinite(sn)) setOffset(sn - receivedAt);
        setState(json);
        failures.current = 0;
        setReconnecting(false);
        schedule(INTERVAL);
      } catch {
        if (!alive.current) return;
        failures.current += 1;
        setReconnecting(true);
        schedule(Math.min(MAX_BACKOFF, INTERVAL * 2 ** failures.current));
      } finally {
        window.clearTimeout(kill);
      }
    })();
    inflight.current = run;
    try {
      await run;
    } finally {
      inflight.current = null;
    }
  }, [schedule]);

  const tickRef = useRef(tick);
  useEffect(() => {
    tickRef.current = tick;
  }, [tick]);

  useEffect(() => {
    alive.current = true;
    void tick();
    const onVis = () => {
      if (document.visibilityState === "visible") {
        failures.current = 0;
        void tickRef.current();
      } else if (timer.current) {
        window.clearTimeout(timer.current);
        timer.current = null;
      }
    };
    const onOnline = () => {
      failures.current = 0;
      void tickRef.current();
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("online", onOnline);
    window.addEventListener("focus", onOnline);
    return () => {
      alive.current = false;
      if (timer.current) window.clearTimeout(timer.current);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("focus", onOnline);
    };
  }, [tick]);

  const refresh = useCallback(async () => {
    // Wait for any running poll, then run a fresh one so the result reflects the mutation.
    if (inflight.current) await inflight.current.catch(() => {});
    await tick();
  }, [tick]);

  return { state, serverOffsetMs, reconnecting, refresh };
}
