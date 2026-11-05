"use client";

import { useId, type ReactNode } from "react";
import { cx } from "./cx";
import s from "./ScoreInput.module.css";

export type Score = 1 | 2 | 3 | 4 | 5;

export type ScoreInputProps = {
  /** Row label, e.g. "Level". */
  label: ReactNode;
  value: Score | null;
  onChange: (value: Score) => void;
  /** Aspect color: level | enemy | ability | puzzle. */
  aspect?: "level" | "enemy" | "ability" | "puzzle";
  /** Optional sub-label, e.g. "Does the space create the feeling?" */
  hint?: ReactNode;
  /** Five word labels for 1..5. Default Weak / Okay / Good / Great / Brilliant. */
  labels?: [string, string, string, string, string];
  disabled?: boolean;
  name?: string;
  className?: string;
};

const DEFAULT_LABELS: [string, string, string, string, string] = ["Weak", "Okay", "Good", "Great", "Brilliant"];

/** 1-5 segmented control (native radios: arrow keys move, Space selects). */
export function ScoreInput({ label, value, onChange, aspect, hint, labels = DEFAULT_LABELS, disabled, name, className }: ScoreInputProps) {
  const autoId = useId();
  const group = name ?? `sc${autoId}`;
  return (
    <fieldset className={cx(s.wrap, aspect && s[`a-${aspect}`], value && s.answered, className)} disabled={disabled}>
      <legend className={s.legend}>
        <span className={s.name}>{label}</span>
        {value ? (
          <span className={s.picked} key={value}>
            {value} &middot; {labels[value - 1]}
          </span>
        ) : (
          <span className={s.pending}>tap a score</span>
        )}
      </legend>
      {hint && <p className={s.hint}>{hint}</p>}
      <div className={s.seg}>
        {([1, 2, 3, 4, 5] as Score[]).map((n) => {
          const on = value === n;
          return (
            <label key={n} className={cx(s.opt, on && s.on, value !== null && n <= value && s.filled)}>
              <input
                type="radio"
                name={group}
                value={n}
                checked={on}
                onChange={() => onChange(n)}
                className={s.radio}
                aria-label={`${n}, ${labels[n - 1]}`}
              />
              <span className={s.num}>{n}</span>
              <span className={s.word}>{labels[n - 1]}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
