import { cx } from "./cx";
import s from "./Wordmark.module.css";

export type WordmarkProps = {
  /** sm = header bar, md = card, lg = join screen, hero = projector. Default "md". */
  size?: "sm" | "md" | "lg" | "hero";
  /** stacked (default) or inline (single row, for top bars). */
  layout?: "stacked" | "inline";
  /** Optional small line above, e.g. "ENGL 175". */
  kicker?: string;
  /** Play the slam-in entrance animation. */
  animate?: boolean;
  className?: string;
};

/** "Design Your Level" logo built from type: phosphor terminal word + ink-on-parchment sticker. */
export function Wordmark({ size = "md", layout = "stacked", kicker, animate, className }: WordmarkProps) {
  return (
    <div
      className={cx(s.mark, s[size], s[layout], animate && s.animate, className)}
      role="img"
      aria-label="Design Your Level"
    >
      {kicker && (
        <span className={s.kicker} aria-hidden>
          {kicker}
        </span>
      )}
      <span className={s.design} aria-hidden>
        <span className={s.prompt}>&gt;</span>DESIGN<span className={s.caret} />
      </span>
      <span className={s.level} aria-hidden>
        <span className={s.your}>Your</span> Level
      </span>
    </div>
  );
}
