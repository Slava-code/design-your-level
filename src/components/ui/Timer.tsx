"use client";

import { useEffect, useRef, useState } from "react";
import { cx } from "./cx";
import s from "./Timer.module.css";

export type TimerProps = {
  /** ISO time the countdown ends at (from /api/state phase_ends_at). null/undefined shows "--:--". */
  endsAt?: string | null;
  /**
   * serverNow - clientNow, in ms. Compute once per poll:
   * `serverOffsetMs = Date.parse(state.serverTime) - Date.now()`.
   * The timer then counts against `Date.now() + serverOffsetMs`.
   */
  serverOffsetMs?: number;
  /** sm = inline badge, md = team header, lg = admin, giant = projector. Default "md". */
  size?: "sm" | "md" | "lg" | "giant";
  /** Optional caption under/next to the digits, e.g. "Design time". */
  label?: string;
  /** Seconds at which the "hurry" state (pulse + color shift) starts. Default 10. */
  warnAt?: number;
  /** Caption shown once the countdown hits zero (replaces `label`). null = no caption. Default "Time's up". */
  expiredLabel?: string | null;
  /** Fires once when the countdown reaches zero. Display only; never advance phases from this. */
  onExpire?: () => void;
  /** Milliseconds left while the countdown is paused (state.timerPausedMs). Shows frozen digits + "Paused". */
  pausedMs?: number | null;
  className?: string;
};

function fmt(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const sec = total % 60;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

/** Countdown synced to server time. mm:ss in VT323; pulses and turns amber->red in the last seconds. */
export function Timer({ endsAt, serverOffsetMs = 0, size = "md", label, expiredLabel = "Time's up", warnAt = 10, onExpire, pausedMs, className }: TimerProps) {
  const [now, setNow] = useState<number | null>(null);
  const expiredFor = useRef<string | null>(null);
  const onExpireRef = useRef(onExpire);
  useEffect(() => {
    onExpireRef.current = onExpire;
  });

  useEffect(() => {
    setNow(Date.now());
    if (!endsAt) return;
    const id = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(id);
  }, [endsAt]);

  const end = endsAt ? Date.parse(endsAt) : NaN;
  const hasTimer = Number.isFinite(end) && now !== null;
  const remaining = hasTimer ? end - (now + serverOffsetMs) : 0;
  const secsLeft = Math.ceil(remaining / 1000);
  const expired = hasTimer && remaining <= 0;
  const hurry = hasTimer && !expired && secsLeft <= warnAt;
  const critical = hurry && secsLeft <= Math.min(5, warnAt);

  useEffect(() => {
    if (expired && endsAt && expiredFor.current !== endsAt) {
      expiredFor.current = endsAt;
      onExpireRef.current?.();
    }
  }, [expired, endsAt]);

  const paused = pausedMs != null && !endsAt;
  if (paused) {
    return (
      <div className={cx(s.timer, s[size], s.paused, className)} role="timer" aria-label={`Timer paused with ${fmt(pausedMs)} left`}>
        <span className={s.digits} aria-hidden>
          {fmt(pausedMs)}
        </span>
        <span className={s.label} aria-hidden>
          Paused
        </span>
      </div>
    );
  }

  const text = hasTimer ? fmt(remaining) : "--:--";
  const ariaText = !hasTimer
    ? "No timer running"
    : expired
      ? "Time is up"
      : `${Math.floor(Math.max(0, secsLeft) / 60)} minutes ${Math.max(0, secsLeft) % 60} seconds left`;

  return (
    <div
      className={cx(
        s.timer,
        s[size],
        !hasTimer && s.empty,
        hurry && s.hurry,
        critical && s.critical,
        expired && s.expired,
        className,
      )}
      role="timer"
      aria-label={label ? `${label}: ${ariaText}` : ariaText}
    >
      <span className={s.digits} key={hurry ? secsLeft : "steady"} aria-hidden>
        {text}
      </span>
      {(expired ? expiredLabel : label) && (
        <span className={s.label} aria-hidden>
          {expired ? expiredLabel : label}
        </span>
      )}
    </div>
  );
}
