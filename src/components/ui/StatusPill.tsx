import { cx } from "./cx";
import s from "./StatusPill.module.css";

export type Status = "drafting" | "asking" | "generating" | "submitted" | "idle" | "error" | "done" | "voting";

export type StatusPillProps = {
  status: Status;
  /** Override the default label text. */
  label?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
};

const LABELS: Record<Status, string> = {
  drafting: "Drafting",
  asking: "Asking",
  generating: "Generating",
  submitted: "Submitted",
  idle: "Idle",
  error: "Error",
  done: "Done",
  voting: "Voting",
};

/** Activity/status badge. Live states (asking, generating) animate. Unknown values fall back to "idle". */
export function StatusPill({ status, label, size = "md", className }: StatusPillProps) {
  const known: Status = status in LABELS ? status : "idle";
  return (
    <span className={cx(s.pill, s[known], s[size], className)} data-status={known}>
      <span className={s.dot} aria-hidden />
      {label ?? LABELS[known]}
    </span>
  );
}
