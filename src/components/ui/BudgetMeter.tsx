import { cx } from "./cx";
import s from "./BudgetMeter.module.css";
import { creditsLeft, toCredits } from "@/lib/credits";

export type BudgetMeterProps = {
  spentUsd: number;
  budgetUsd: number;
  /** Money held for an in-flight call (drawn striped after spent). */
  reservedUsd?: number;
  /** Optional rough cost per generation, to show "about N left". */
  perGenerationUsd?: number;
  label?: string;
  /** compact = single line for table rows. */
  compact?: boolean;
  /** "credits" shows whole credits (1 credit = $0.01) instead of dollars. Default "usd". */
  unit?: "usd" | "credits";
  className?: string;
};

const usd = (n: number) => `$${(Math.round(n * 100) / 100).toFixed(2)}`;

/** Spent / remaining budget with a segmented bar. Turns amber under 25% and red under 10%. */
export function BudgetMeter({
  spentUsd,
  budgetUsd,
  reservedUsd = 0,
  perGenerationUsd,
  label = "Budget",
  compact,
  unit = "usd",
  className,
}: BudgetMeterProps) {
  const budget = Math.max(0, budgetUsd);
  const spent = Math.max(0, spentUsd);
  const reserved = Math.max(0, reservedUsd);
  const remaining = Math.max(0, budget - spent - reserved);
  const pct = (n: number) => (budget > 0 ? Math.min(100, (n / budget) * 100) : 100);
  const ratio = budget > 0 ? remaining / budget : 0;
  const tone = ratio <= 0.1 ? "low" : ratio <= 0.25 ? "mid" : "ok";
  const gensLeft = perGenerationUsd && perGenerationUsd > 0 ? Math.floor(remaining / perGenerationUsd) : null;
  const cr = unit === "credits";
  const fmt = (n: number) => (cr ? String(toCredits(n)) : usd(n));
  const leftText = cr ? String(creditsLeft(budget, spent + reserved)) : usd(remaining);
  const ofText = cr ? `/ ${toCredits(budget)} credits` : `/ ${usd(budget)}`;

  return (
    <div className={cx(s.meter, s[tone], compact && s.compact, className)}>
      {!compact && (
        <div className={s.top}>
          <span className={s.label}>{label}</span>
          <span className={s.left}>
            <span className={s.money}>{leftText}</span> left
          </span>
        </div>
      )}
      <div
        className={s.track}
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={budget}
        aria-valuenow={Math.min(budget, spent + reserved)}
        aria-valuetext={`${fmt(spent)} spent ${ofText}, ${leftText} left`}
      >
        <span className={s.spent} style={{ width: `${pct(spent)}%` }} />
        {reserved > 0 && <span className={s.reserved} style={{ left: `${pct(spent)}%`, width: `${pct(reserved)}%` }} />}
      </div>
      <div className={s.bottom}>
        <span>
          {fmt(spent)} <span className={s.of}>{ofText}</span>
        </span>
        {compact ? (
          <span className={s.money}>{leftText} left</span>
        ) : gensLeft !== null ? (
          <span>about {gensLeft} more {gensLeft === 1 ? "storyboard" : "storyboards"}</span>
        ) : null}
      </div>
    </div>
  );
}
