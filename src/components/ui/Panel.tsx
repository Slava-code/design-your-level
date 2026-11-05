import type { HTMLAttributes, ReactNode, ElementType } from "react";
import { cx } from "./cx";
import s from "./Panel.module.css";

export type PanelVariant = "terminal" | "parchment" | "plain";

export type PanelProps = HTMLAttributes<HTMLElement> & {
  /** terminal = phosphor glass with scanlines; parchment = aged paper (flips tokens to ink); plain = subtle card. */
  variant?: PanelVariant;
  /** Small letterspaced label above the title (VT323 on terminal, typewriter on paper). */
  kicker?: ReactNode;
  /** Panel heading (rendered as h2 by default). */
  title?: ReactNode;
  /** Heading level for the title. Default "h2". */
  titleAs?: "h1" | "h2" | "h3" | "h4";
  /** Right-aligned header slot (pills, buttons). */
  actions?: ReactNode;
  /** Padding preset. Default "md". */
  pad?: "none" | "sm" | "md" | "lg";
  /** Tilt the panel a little, sticker style (degrees, e.g. -1.5). */
  tilt?: number;
  /** Disable CRT scanlines on the terminal variant. */
  noScanlines?: boolean;
  /** Animate in with pop-in. */
  pop?: boolean;
  as?: ElementType;
};

/** Card/container in one of the two deck surfaces. Children inherit the surface tokens. */
export function Panel({
  variant = "terminal",
  kicker,
  title,
  titleAs: H = "h2",
  actions,
  pad = "md",
  tilt,
  noScanlines,
  pop,
  as: Tag = "section",
  className,
  style,
  children,
  ...rest
}: PanelProps) {
  const surface = variant === "parchment" ? "surface-paper" : "surface-terminal";
  return (
    <Tag
      className={cx(
        s.panel,
        s[variant],
        s[`pad-${pad}`],
        surface,
        variant === "terminal" && !noScanlines && s.scan,
        pop && "anim-pop-in",
        className,
      )}
      style={tilt ? { ...style, ["--tilt" as string]: `${tilt}deg`, transform: `rotate(${tilt}deg)` } : style}
      {...rest}
    >
      {(kicker || title || actions) && (
        <header className={s.head}>
          <div className={s.headText}>
            {kicker && <div className={s.kicker}>{kicker}</div>}
            {title && <H className={s.title}>{title}</H>}
          </div>
          {actions && <div className={s.actions}>{actions}</div>}
        </header>
      )}
      {children}
    </Tag>
  );
}
