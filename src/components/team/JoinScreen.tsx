"use client";

import { useEffect, useRef, useState } from "react";
import type { JoinResponse } from "@/lib/types";
import { Button, Wordmark, cx } from "@/components/ui";
import { post } from "./api";
import s from "./shell.module.css";

type Props = { message?: string | null; onJoined: (r: JoinResponse) => void | Promise<void> };

/** Big friendly join screen: one input for the 3-word code. */
export function JoinScreen({ message, onJoined }: Props) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(0);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const inputRef = useRef<HTMLInputElement>(null);

  const lockLeft = lockedUntil ? Math.max(0, Math.ceil((lockedUntil - now) / 1000)) : 0;

  useEffect(() => {
    if (!lockedUntil) return;
    const id = window.setInterval(() => {
      const n = Date.now();
      setNow(n);
      if (n >= lockedUntil) {
        setLockedUntil(null);
        setError(null);
      }
    }, 500);
    return () => window.clearInterval(id);
  }, [lockedUntil]);

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (busy || lockLeft > 0) return;
    const clean = code.trim();
    if (!clean) {
      setError("Type the 3-word code from your team's card.");
      setShake((n) => n + 1);
      inputRef.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    const r = await post<JoinResponse>("/api/join", { code: clean });
    if (r.ok) {
      await onJoined(r.data);
      setBusy(false);
      return;
    }
    setBusy(false);
    setShake((n) => n + 1);
    if (r.error.code === "rate_limited") {
      const sec = r.error.retryAfterSec ?? 60;
      setLockedUntil(Date.now() + sec * 1000);
      setNow(Date.now());
      setError("Too many wrong codes from this network. Wait a moment, then try again.");
    } else {
      setError(r.error.error);
    }
    inputRef.current?.focus();
    inputRef.current?.select();
  }

  return (
    <main className={s.join}>
      <div className={s.joinBanner} aria-hidden />
      <div className={s.joinInner}>
        <div className={s.joinMark}>
          <Wordmark size="lg" kicker="Live activity" animate />
        </div>
        <form className={cx(s.joinCard, "anim-pop-in")} onSubmit={submit} noValidate>
          {message && (
            <p className={s.joinNotice} role="status">
              {message}
            </p>
          )}
          <label htmlFor="team-code" className={s.joinLabel}>
            Your team code
          </label>
          <p className={s.joinHint} id="team-code-hint">
            Three words from the card on your table. Spaces or dashes both work.
          </p>
          <div key={shake} className={cx(s.codeWrap, shake > 0 && error && s.shake)}>
            <span className={s.codePrompt} aria-hidden>
              &gt;
            </span>
            <input
              ref={inputRef}
              id="team-code"
              name="team-code"
              className={s.codeInput}
              value={code}
              onChange={(e) => {
                setCode(e.target.value);
                if (error && !lockLeft) setError(null);
              }}
              placeholder="three-word-code"
              autoCapitalize="none"
              autoCorrect="off"
              autoComplete="off"
              spellCheck={false}
              enterKeyHint="go"
              maxLength={80}
              aria-describedby={cx("team-code-hint", error && "team-code-err") || undefined}
              aria-invalid={error ? true : undefined}
              disabled={busy}
            />
          </div>
          <div className={s.joinErrSlot} aria-live="assertive">
            {error && (
              <p id="team-code-err" className={s.joinErr} role="alert">
                {error}
                {lockLeft > 0 && <span className={s.joinLock}> Try again in {lockLeft}s.</span>}
              </p>
            )}
          </div>
          <Button type="submit" size="xl" block loading={busy} loadingText="Joining" disabled={lockLeft > 0}>
            {lockLeft > 0 ? `Wait ${lockLeft}s` : "Join"}
          </Button>
        </form>
        <ol className={s.joinSteps} aria-label="How it works">
          <li>
            <span className={s.stepNum}>1</span> Design a level together
          </li>
          <li>
            <span className={s.stepNum}>2</span> AI draws your storyboard
          </li>
          <li>
            <span className={s.stepNum}>3</span> Vote. Best design wins.
          </li>
        </ol>
      </div>
    </main>
  );
}
