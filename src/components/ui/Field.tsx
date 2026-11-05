"use client";

import { useId, useRef, type ReactNode } from "react";
import { cx } from "./cx";
import s from "./Field.module.css";

export type FieldProps = {
  /** Visible label (big, bold). */
  label: ReactNode;
  /** Current value (controlled). */
  value: string;
  onChange: (value: string) => void;
  /** Helper line under the label, e.g. "How does it create your feeling?" */
  hint?: ReactNode;
  /** Small aspect tag shown before the label: "level" | "enemy" | "ability" | "puzzle" colors it. */
  aspect?: "level" | "enemy" | "ability" | "puzzle";
  /** Multi-line textarea (default true). false renders a single-line input. */
  multiline?: boolean;
  rows?: number;
  placeholder?: string;
  /** Shows a live "n / max" counter and enforces maxLength. */
  maxLength?: number;
  /** Clickable example chips; clicking inserts the text. */
  examples?: string[];
  /** "append" (default) adds ", example" to existing text; "replace" swaps the value. */
  exampleMode?: "append" | "replace";
  /** Label before the chips. Default "Try:". */
  examplesLabel?: string;
  /** Error text (sets aria-invalid). */
  error?: ReactNode;
  disabled?: boolean;
  required?: boolean;
  id?: string;
  name?: string;
  autoFocus?: boolean;
  /** Extra content under the input, e.g. an ImageDropzone. */
  children?: ReactNode;
  inputMode?: "text" | "search" | "none";
  autoComplete?: string;
  className?: string;
  /** Larger input text, e.g. for the join code. */
  big?: boolean;
  onBlur?: () => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
};

/** Labeled text input/textarea with hint, char counter and example chips. Adapts to surface tokens. */
export function Field({
  label,
  value,
  onChange,
  hint,
  aspect,
  multiline = true,
  rows = 3,
  placeholder,
  maxLength,
  examples,
  exampleMode = "append",
  examplesLabel = "Try:",
  error,
  disabled,
  required,
  id,
  name,
  autoFocus,
  children,
  inputMode,
  autoComplete,
  className,
  big,
  onBlur,
  onKeyDown,
}: FieldProps) {
  const autoId = useId();
  const fieldId = id ?? `f${autoId}`;
  const hintId = hint ? `${fieldId}-hint` : undefined;
  const errId = error ? `${fieldId}-err` : undefined;
  const ref = useRef<HTMLTextAreaElement & HTMLInputElement>(null);
  const count = value.length;
  const nearLimit = maxLength ? count >= maxLength * 0.9 : false;

  function insert(example: string) {
    let next: string;
    if (exampleMode === "replace" || !value.trim()) next = example;
    else if (value.toLowerCase().includes(example.toLowerCase())) next = value;
    else next = `${value.replace(/[\s,]+$/, "")}, ${example}`;
    if (maxLength) next = next.slice(0, maxLength);
    onChange(next);
    requestAnimationFrame(() => {
      const el = ref.current;
      if (el) {
        el.focus();
        el.setSelectionRange(next.length, next.length);
      }
    });
  }

  const common = {
    id: fieldId,
    name,
    value,
    placeholder,
    maxLength,
    disabled,
    required,
    autoFocus,
    autoComplete,
    inputMode,
    "aria-describedby": cx(hintId, errId) || undefined,
    "aria-invalid": error ? true : undefined,
    className: cx(s.input, big && s.big),
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(e.target.value),
    onBlur,
    onKeyDown,
  };

  return (
    <div className={cx(s.field, !!error && s.hasError, disabled && s.disabled, className)} data-aspect={aspect}>
      <div className={s.top}>
        <label htmlFor={fieldId} className={s.label}>
          {aspect && <span className={cx(s.aspect, s[`a-${aspect}`])} aria-hidden />}
          <span>{label}</span>
          {required && <span className={s.req} aria-hidden>*</span>}
        </label>
        {maxLength ? (
          <span className={cx(s.counter, nearLimit && s.counterHot)} aria-live="polite" aria-atomic>
            {count}/{maxLength}
          </span>
        ) : null}
      </div>
      {hint && (
        <p id={hintId} className={s.hint}>
          {hint}
        </p>
      )}
      {multiline ? <textarea ref={ref} rows={rows} {...common} /> : <input ref={ref} type="text" {...common} />}
      {examples && examples.length > 0 && (
        <div className={s.examples}>
          <span className={s.examplesLabel}>{examplesLabel}</span>
          {examples.map((ex) => (
            <button
              key={ex}
              type="button"
              className={s.chip}
              onClick={() => insert(ex)}
              disabled={disabled}
              aria-label={`Insert example: ${ex}`}
            >
              <span aria-hidden className={s.plus}>+</span>
              {ex}
            </button>
          ))}
        </div>
      )}
      {error && (
        <p id={errId} className={s.error} role="alert">
          {error}
        </p>
      )}
      {children}
    </div>
  );
}
