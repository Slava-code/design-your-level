import { cx } from "@/components/ui";
import s from "./shell.module.css";

/** Start room -> 3 rooms -> exit, drawn as a neon corridor with a player blip walking through it. */
export function RoomPath({ compact, className }: { compact?: boolean; className?: string }) {
  return (
    <div className={cx(s.path, compact && s.pathCompact, className)} aria-hidden>
      <div className={s.pathTrack}>
        <span className={cx(s.pathNode, s.pathEnd)}>START</span>
        <span className={s.pathLink} />
        <span className={s.pathRoom}>1</span>
        <span className={s.pathLink} />
        <span className={s.pathRoom}>2</span>
        <span className={s.pathLink} />
        <span className={s.pathRoom}>3</span>
        <span className={s.pathLink} />
        <span className={cx(s.pathNode, s.pathEnd, s.pathExit)}>EXIT</span>
        <span className={s.blip} />
      </div>
    </div>
  );
}
