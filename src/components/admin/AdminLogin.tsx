"use client";

import { useState } from "react";
import { Button, Panel, Wordmark } from "@/components/ui";
import type { OkResponse } from "@/lib/types";
import { api } from "./lib";
import s from "./admin.module.css";

/** Admin code form. The code is masked, sent once, and never stored or shown again. */
export function AdminLogin({ expired, onDone, compact }: { expired?: boolean; onDone: () => void; compact?: boolean }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [show, setShow] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim() || busy) return;
    setBusy(true);
    setError(null);
    const r = await api<OkResponse>("/api/admin/login", { code });
    setBusy(false);
    if (r.ok) {
      setCode("");
      onDone();
      return;
    }
    setError(r.code === "rate_limited" ? `${r.error}` : r.error);
  }

  return (
    <main className={s.loginPage}>
      <div className={s.loginWrap}>
        {!compact && <Wordmark size="lg" kicker="Control room" animate />}
        <Panel variant="terminal" pad="lg" className={s.loginCard} kicker="Presenter only" title="Admin login" pop>
          {expired && <p className={s.notice}>Your admin session ended (a new game was started elsewhere). Log in again.</p>}
          <form onSubmit={submit} className={s.loginForm}>
            <label className={s.codeLabel} htmlFor="admin-code">
              Admin code
            </label>
            <div className={s.codeRow}>
              <input
                id="admin-code"
                className={s.codeInput}
                type={show ? "text" : "password"}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                placeholder="five-hyphenated-words"
                autoFocus
                maxLength={300}
                aria-invalid={!!error || undefined}
                aria-describedby={error ? "admin-code-err" : undefined}
              />
              <button type="button" className={s.peekBtn} onClick={() => setShow((v) => !v)} aria-pressed={show}>
                {show ? "Hide" : "Show"}
              </button>
            </div>
            {error && (
              <p id="admin-code-err" className={s.err} role="alert">
                {error}
              </p>
            )}
            <Button type="submit" size="lg" block loading={busy} loadingText="Checking" disabled={!code.trim()}>
              Enter the control room
            </Button>
          </form>
          <p className={s.loginFoot}>
            Presenter only. Logging in here also unlocks the projector view (<span className="vt">/screen</span>) in this browser.
          </p>
        </Panel>
      </div>
    </main>
  );
}
