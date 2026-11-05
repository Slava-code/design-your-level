"use client";

import type { GenerationView } from "@/lib/types";
import { cx } from "@/components/ui";
import s from "./design.module.css";

const STATUS_TEXT: Record<string, string> = {
  asking: "Reading",
  questions: "Questions",
  generating: "Drawing",
  refused: "Refused",
  error: "Failed",
  flagged: "Flagged",
};

type Props = {
  generations: GenerationView[];
  selectedId: string | null;
  submittedId: string | null;
  onSelect: (id: string) => void;
};

/** Every generation, newest first; tap to reopen. */
export function HistoryStrip({ generations, selectedId, submittedId, onSelect }: Props) {
  const n = generations.length;
  return (
    <nav className={s.history} aria-label="All your storyboards">
      <div className={s.historyHead}>
        <h3 className={s.historyTitle}>History</h3>
        <span className={s.historyCount}>
          {n} {n === 1 ? "version" : "versions"}
        </span>
      </div>
      <ul className={s.historyList}>
        {generations.map((g, i) => {
          const v = n - i;
          const sel = g.id === selectedId;
          const sub = g.id === submittedId;
          const live = g.status === "asking" || g.status === "generating" || g.status === "questions";
          const label = `Version ${v}${sub ? ", submitted" : ""}${g.status !== "done" ? `, ${STATUS_TEXT[g.status] ?? g.status}` : ""}`;
          return (
            <li key={g.id}>
              <button
                type="button"
                className={cx(s.hTile, sel && s.hSel, sub && s.hSub, live && s.hLive, g.status !== "done" && !live && s.hBad)}
                onClick={() => onSelect(g.id)}
                aria-current={sel ? "true" : undefined}
                aria-label={label}
              >
                {g.status === "done" && g.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={g.imageUrl} alt="" className={s.hImg} loading="lazy" />
                ) : (
                  <span className={s.hPlaceholder}>{STATUS_TEXT[g.status] ?? g.status}</span>
                )}
                <span className={s.hVer}>v{v}</span>
                {sub && <span className={s.hBadge}>Entry</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
