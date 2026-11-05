import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";
import s from "./Button.module.css";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg" | "xl";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** primary = phosphor (or ink on paper); secondary = ink/parchment slab; ghost = outline; danger = red. Default "primary". */
  variant?: ButtonVariant;
  /** sm 40px (dense admin rows), md 48px (default), lg 60px, xl 76px (hero CTAs). */
  size?: ButtonSize;
  /** Shows a spinner, sets aria-busy and disables the button. */
  loading?: boolean;
  /** Text shown while loading (defaults to children). */
  loadingText?: ReactNode;
  /** Stretch to full width of the container. */
  block?: boolean;
  /** Optional leading icon / glyph (no emojis). */
  icon?: ReactNode;
};

/**
 * Chunky party-game button with a pressable "slab" shadow.
 * Works inside Server Components (no hooks); pass onClick from a client component.
 */
export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  loadingText,
  block = false,
  icon,
  className,
  disabled,
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(s.btn, s[variant], s[size], block && s.block, loading && s.loading, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      <span className={s.face}>
        {loading ? <span className={s.spinner} aria-hidden /> : icon ? <span className={s.icon}>{icon}</span> : null}
        <span className={s.label}>{loading && loadingText ? loadingText : children}</span>
      </span>
    </button>
  );
}
