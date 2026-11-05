"use client";

import { useEffect, useState, type ReactNode } from "react";
import { cx } from "./cx";
import s from "./ProgressStages.module.css";

export type Stage = { id: string; label: ReactNode; hint?: ReactNode };

export type ProgressStagesProps = {
  stages: Stage[];
  /** Index of the stage in progress. stages.length = all done. */
  current: number;
  /** When the whole process started (ms epoch, Date or ISO). Drives the elapsed-seconds counter. */
  startedAt?: number | string | Date | null;
  /** Freeze/stop the counter and mark the current stage as failed. */
  failed?: boolean;
  /** Headline above the list, e.g. "Drawing your storyboard". */
  title?: ReactNode;
  /** Caption next to the counter. Default "elapsed". */
  elapsedLabel?: string;
  className?: string;
};

function toMs(v: ProgressStagesProps["startedAt"]): number | null {
  if (v == null) return null;
  if (typeof v === "number") return v;
  if (v instanceof Date) return v.getTime();
  const n = Date.parse(v);
  return Number.isFinite(n) ? n : null;
}

/** Loading checklist: done stages ticked, current one animated, plus a live elapsed-seconds counter. */
export function ProgressStages({
  stages,
  current,
  startedAt,
  failed,
  title,
  elapsedLabel = "elapsed",
  className,
}: ProgressStagesProps) {
  const start = toMs(startedAt);
  const done = current >= stages.length;
  const running = start !== null && !done && !failed;
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    if (!running) return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [running]);

  const elapsed = start !== null && now !== null ? Math.max(0, (now - start) / 1000) : null;

  return (
    <div className={cx(s.wrap, failed && s.failed, done && s.allDone, className)} role="status" aria-live="polite">
      {(title || elapsed !== null) && (
        <div className={s.head}>
          {title && <div className={s.title}>{title}</div>}
          {elapsed !== null && (
            <div className={s.elapsed}>
              <span className={s.secs}>{elapsed.toFixed(0)}</span>
              <span className={s.unit}>s {elapsedLabel}</span>
            </div>
          )}
        </div>
      )}
      <ol className={s.list}>
        {stages.map((st, i) => {
          const state = i < current ? "done" : i === current ? (failed ? "fail" : "active") : "todo";
          return (
            <li key={st.id} className={cx(s.item, s[state])} aria-current={state === "active" ? "step" : undefined}>
              <span className={s.mark} aria-hidden>
                {state === "done" ? "✓" : state === "fail" ? "!" : state === "active" ? "" : String(i + 1)}
              </span>
              <span className={s.text}>
                <span className={s.label}>{st.label}</span>
                {st.hint && state === "active" && <span className={s.hint}>{st.hint}</span>}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
