"use client";

import { useRef, type ReactNode } from "react";
import { cx } from "./cx";
import s from "./Tabs.module.css";

export type TabItem = {
  id: string;
  label: ReactNode;
  /** Small counter bubble, e.g. new feed events. Hidden when 0/undefined. */
  badge?: number | string;
  /** "alert" (default, red: new events) or "calm" (phosphor: a plain count). */
  badgeTone?: "alert" | "calm";
  /** Shows a pulsing dot (work in progress) instead of the badge. */
  busy?: boolean;
  disabled?: boolean;
};

export type TabsProps = {
  items: TabItem[];
  value: string;
  onChange: (id: string) => void;
  /** Prefix for tab/panel ids. Panels should use id={`${idPrefix}-panel-${tab.id}`} and aria-labelledby={`${idPrefix}-tab-${tab.id}`}. */
  idPrefix?: string;
  /** Stretch tabs to fill the row. */
  fill?: boolean;
  className?: string;
  "aria-label"?: string;
};

/** Tab strip (ARIA tablist, arrow/Home/End keys). Render the active panel yourself. */
export function Tabs({ items, value, onChange, idPrefix = "tabs", fill, className, ...aria }: TabsProps) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const enabled = items.filter((t) => !t.disabled);

  function move(delta: number | "first" | "last") {
    const idx = enabled.findIndex((t) => t.id === value);
    let next: number;
    if (delta === "first") next = 0;
    else if (delta === "last") next = enabled.length - 1;
    else next = (idx + delta + enabled.length) % enabled.length;
    const t = enabled[next];
    if (t) {
      onChange(t.id);
      refs.current[t.id]?.focus();
    }
  }

  return (
    <div
      role="tablist"
      aria-label={aria["aria-label"]}
      className={cx(s.list, fill && s.fill, className)}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") move(1);
        else if (e.key === "ArrowLeft") move(-1);
        else if (e.key === "Home") move("first");
        else if (e.key === "End") move("last");
        else return;
        e.preventDefault();
      }}
    >
      {items.map((t) => {
        const active = t.id === value;
        return (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[t.id] = el;
            }}
            type="button"
            role="tab"
            id={`${idPrefix}-tab-${t.id}`}
            aria-selected={active}
            aria-controls={`${idPrefix}-panel-${t.id}`}
            tabIndex={active ? 0 : -1}
            disabled={t.disabled}
            className={cx(s.tab, active && s.active)}
            onClick={() => onChange(t.id)}
          >
            <span>{t.label}</span>
            {t.busy ? (
              <span className={s.busyDot} aria-label="in progress" />
            ) : (
              t.badge !== undefined &&
              t.badge !== 0 &&
              t.badge !== "" && (
                <span className={cx(s.badge, t.badgeTone === "calm" && s.calm)} key={String(t.badge)}>
                  {t.badge}
                </span>
              )
            )}
          </button>
        );
      })}
    </div>
  );
}
