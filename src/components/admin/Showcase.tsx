"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { cx } from "@/components/ui";
import type { ShowcaseEntry } from "@/lib/types";
import s from "./showcase.module.css";

const PLACE: Record<number, string> = { 1: "Winner", 2: "2nd place", 3: "3rd place" };
const ASPECTS = [
  { k: "level", label: "Level" },
  { k: "enemy", label: "Enemy" },
  { k: "ability", label: "Ability" },
  { k: "puzzle", label: "Puzzle" },
] as const;

type Props = {
  entries: ShowcaseEntry[];
  slot: number;
  onChange: (slot: number) => void;
  onClose: () => void;
};

/** Projector: one submitted design full screen (storyboard + what the team wrote) so the team can present it. */
export function Showcase({ entries, slot, onChange, onClose }: Props) {
  const i = Math.max(0, entries.findIndex((e) => e.slot === slot));
  const e = entries[i];
  const closeRef = useRef<HTMLButtonElement>(null);
  const prev = entries.length > 1 ? entries[(i - 1 + entries.length) % entries.length] : null;
  const next = entries.length > 1 ? entries[(i + 1) % entries.length] : null;

  useEffect(() => {
    closeRef.current?.focus();
  }, []);
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") onClose();
      else if (ev.key === "ArrowRight" && next) onChange(next.slot);
      else if (ev.key === "ArrowLeft" && prev) onChange(prev.slot);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, prev, onChange, onClose]);

  if (!e) return null;
  const f = e.inputs;
  // Portalled to <body>: the screen's animated containers would otherwise trap a fixed overlay under the top bar.
  return createPortal(
    <div className={s.overlay} role="dialog" aria-modal="true" aria-label={`${e.name}'s design`}>
      <header className={s.head}>
        <h2 className={s.name}>
          {e.place != null && e.place <= 3 && <span className={cx(s.ribbon, s[`r${e.place}`])}>{PLACE[e.place]}</span>}
          <span className={s.nameText}>{e.name}</span>
        </h2>
        <div className={s.controls}>
          {prev && (
            <button type="button" className={s.ctl} onClick={() => onChange(prev.slot)} aria-label={`Previous: ${prev.name}`}>
              &larr; Prev
            </button>
          )}
          {next && (
            <button type="button" className={s.ctl} onClick={() => onChange(next.slot)} aria-label={`Next: ${next.name}`}>
              Next &rarr;
            </button>
          )}
          <button type="button" ref={closeRef} className={cx(s.ctl, s.close)} onClick={onClose}>
            Close
          </button>
        </div>
      </header>
      <div className={s.body} key={e.slot}>
        <figure className={s.art}>
          {e.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={e.imageUrl} alt={`Storyboard by ${e.name}`} />
          ) : (
            <div className={s.noImg}>No storyboard</div>
          )}
        </figure>
        <section className={s.text} aria-label="What they wrote">
          <div className={s.tags}>
            {f.genre && (
              <p className={s.tag}>
                <span className={s.key}>Genre</span> {f.genre}
              </p>
            )}
            {f.feeling && (
              <p className={cx(s.tag, s.tagFeel)}>
                <span className={s.key}>Feeling</span> {f.feeling}
              </p>
            )}
            {f.artStyle && (
              <p className={s.tag}>
                <span className={s.key}>Art style</span> {f.artStyle}
              </p>
            )}
          </div>
          <dl className={s.aspects}>
            {ASPECTS.map((a) => (
              <div key={a.k} className={s.aspect} data-aspect={a.k}>
                <dt className={s.aspectName}>{a.label}</dt>
                <dd className={s.aspectText}>{f[a.k] || <span className={s.blank}>(left blank)</span>}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
      <p className={s.hint}>Esc to close{entries.length > 1 ? " · arrow keys for the next design" : ""}</p>
    </div>,
    document.body,
  );
}
