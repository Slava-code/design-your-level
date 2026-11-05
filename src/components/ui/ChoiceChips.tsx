"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import { cx } from "./cx";
import s from "./ChoiceChips.module.css";

export type ChoiceOption = string | { value: string; label?: ReactNode };

export type ChoiceChipsProps = {
  /** Group label (rendered as legend). */
  label: ReactNode;
  hint?: ReactNode;
  options: ChoiceOption[];
  /** Selected value. If it is non-empty and not one of the options, "Other" is selected with this text. */
  value: string;
  onChange: (value: string) => void;
  /** Show an "Other" chip with a free-text input. Default true. */
  allowOther?: boolean;
  otherLabel?: string;
  otherPlaceholder?: string;
  otherMaxLength?: number;
  disabled?: boolean;
  name?: string;
  className?: string;
};

const norm = (o: ChoiceOption) => (typeof o === "string" ? { value: o, label: o } : { value: o.value, label: o.label ?? o.value });

/** Single-select chip group (native radios, so arrow keys work) with optional "Other" free text. */
export function ChoiceChips({
  label,
  hint,
  options,
  value,
  onChange,
  allowOther = true,
  otherLabel = "Other",
  otherPlaceholder = "Type your own",
  otherMaxLength = 60,
  disabled,
  name,
  className,
}: ChoiceChipsProps) {
  const autoId = useId();
  const groupName = name ?? `cc${autoId}`;
  const opts = options.map(norm);
  const isKnown = opts.some((o) => o.value === value);
  const [otherPicked, setOtherPicked] = useState(false);
  const otherActive = allowOther && (otherPicked || (!!value && !isKnown));
  const otherRef = useRef<HTMLInputElement>(null);

  return (
    <fieldset className={cx(s.group, className)} disabled={disabled}>
      <legend className={s.legend}>{label}</legend>
      {hint && <p className={s.hint}>{hint}</p>}
      <div className={s.chips}>
        {opts.map((o) => {
          const checked = !otherActive && value === o.value;
          return (
            <label key={o.value} className={cx(s.chip, checked && s.on)}>
              <input
                type="radio"
                name={groupName}
                value={o.value}
                checked={checked}
                onChange={() => {
                  setOtherPicked(false);
                  onChange(o.value);
                }}
                className={s.radio}
              />
              <span className={s.text}>{o.label}</span>
            </label>
          );
        })}
        {allowOther && (
          <label className={cx(s.chip, s.other, otherActive && s.on)}>
            <input
              type="radio"
              name={groupName}
              value="__other"
              checked={otherActive}
              onChange={() => {
                setOtherPicked(true);
                if (isKnown) onChange("");
                requestAnimationFrame(() => otherRef.current?.focus());
              }}
              className={s.radio}
            />
            <span className={s.text}>{otherLabel}</span>
          </label>
        )}
      </div>
      {otherActive && (
        <input
          ref={otherRef}
          type="text"
          className={s.otherInput}
          value={isKnown ? "" : value}
          maxLength={otherMaxLength}
          placeholder={otherPlaceholder}
          aria-label={`${otherLabel}: type your own`}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </fieldset>
  );
}
