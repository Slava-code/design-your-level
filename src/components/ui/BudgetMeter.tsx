import { cx } from "./cx";
import s from "./BudgetMeter.module.css";

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

  return (
    <div className={cx(s.meter, s[tone], compact && s.compact, className)}>
      {!compact && (
        <div className={s.top}>
          <span className={s.label}>{label}</span>
          <span className={s.left}>
            <span className={s.money}>{usd(remaining)}</span> left
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
        aria-valuetext={`${usd(spent)} spent of ${usd(budget)}, ${usd(remaining)} left`}
      >
        <span className={s.spent} style={{ width: `${pct(spent)}%` }} />
        {reserved > 0 && <span className={s.reserved} style={{ left: `${pct(spent)}%`, width: `${pct(reserved)}%` }} />}
      </div>
      <div className={s.bottom}>
        <span>
          {usd(spent)} <span className={s.of}>/ {usd(budget)}</span>
        </span>
        {compact ? (
          <span className={s.money}>{usd(remaining)} left</span>
        ) : gensLeft !== null ? (
          <span>about {gensLeft} more {gensLeft === 1 ? "storyboard" : "storyboards"}</span>
        ) : null}
      </div>
    </div>
  );
}
