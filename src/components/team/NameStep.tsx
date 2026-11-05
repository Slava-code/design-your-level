"use client";

import { useState } from "react";
import type { RenameResponse, TeamState } from "@/lib/types";
import { Button, cx } from "@/components/ui";
import { post } from "./api";
import s from "./shell.module.css";

type Props = { state: TeamState; onDone: () => void; refresh: () => Promise<void> };

/** Shown right after joining: "You're Team N", with an editable name and a "Let's go" action. */
export function NameStep({ state, onDone, refresh }: Props) {
  const [name, setName] = useState(state.team.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go(e?: React.FormEvent) {
    e?.preventDefault();
    const clean = name.replace(/\s+/g, " ").trim();
    if (!clean) {
      setError("Give your team a name (or keep the number).");
      return;
    }
    if (clean !== state.team.name) {
      setBusy(true);
      const r = await post<RenameResponse>("/api/team/name", { name: clean });
      setBusy(false);
      if (!r.ok) {
        if (r.error.code === "phase") {
          onDone();
          return;
        }
        setError(r.error.error);
        return;
      }
      await refresh();
    }
    onDone();
  }

  return (
    <main className={s.nameStep}>
      <form className={cx(s.nameCard, "anim-pop-in")} onSubmit={go}>
        <p className={s.nameKicker}>Code accepted</p>
        <h1 className={s.nameTitle}>
          You&apos;re <span className={s.nameSlot}>Team {state.team.slot}</span>
        </h1>
        <label htmlFor="team-name" className={s.nameLabel}>
          Pick a team name
        </label>
        <p className={s.nameHint}>Optional. You can change it until voting starts.</p>
        <input
          id="team-name"
          className={s.nameInput}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          onFocus={(e) => e.currentTarget.select()}
          maxLength={32}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="go"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "team-name-err" : undefined}
        />
        <div className={s.nameMeta}>
          <span>{name.length}/32</span>
        </div>
        {error && (
          <p id="team-name-err" className={s.joinErr} role="alert">
            {error}
          </p>
        )}
        <Button type="submit" size="xl" block loading={busy} loadingText="Saving">
          Let&apos;s go
        </Button>
      </form>
    </main>
  );
}
