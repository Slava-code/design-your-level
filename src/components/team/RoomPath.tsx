import { cx } from "@/components/ui";
import s from "./shell.module.css";

/** Start -> enemy -> ability -> exit (the four storyboard panels), drawn as a neon corridor with a player blip walking through it. */
export function RoomPath({ compact, className }: { compact?: boolean; className?: string }) {
  return (
    <div className={cx(s.path, compact && s.pathCompact, className)} aria-hidden>
      <div className={s.pathTrack}>
        <span className={cx(s.pathNode, s.pathEnd)}>START</span>
        <span className={s.pathLink} />
        <span className={s.pathRoom}>E</span>
        <span className={s.pathLink} />
        <span className={s.pathRoom}>A</span>
        <span className={s.pathLink} />
        <span className={s.pathRoom}>P</span>
        <span className={s.pathLink} />
        <span className={cx(s.pathNode, s.pathEnd, s.pathExit)}>EXIT</span>
        <span className={s.blip} />
      </div>
    </div>
  );
}
