"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Button } from "./Button";
import { cx } from "./cx";
import s from "./ConfirmDialog.module.css";

export type ConfirmDialogProps = {
  open: boolean;
  title: ReactNode;
  /** Explanation of what will happen. */
  body?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red confirm button + warning styling. */
  danger?: boolean;
  /**
   * Typed confirmation: the confirm button stays disabled until the user types this exact
   * text (case-insensitive, trimmed). E.g. "RESET".
   */
  requireText?: string;
  /** Shows a spinner on the confirm button. Keep the dialog open while true. */
  busy?: boolean;
  onConfirm: () => void;
  /** Called on cancel, Esc, or backdrop click. */
  onCancel: () => void;
  /** Paper (parchment) look instead of terminal. */
  surface?: "terminal" | "paper";
};

/** Modal confirm built on <dialog>. Focus-trapped by the browser; Esc cancels. */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger,
  requireText,
  busy,
  onConfirm,
  onCancel,
  surface = "terminal",
}: ConfirmDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const [typed, setTyped] = useState("");
  const id = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      setTyped("");
      d.showModal();
    } else if (!open && d.open) {
      d.close();
    }
  }, [open]);

  const matches = !requireText || typed.trim().toLowerCase() === requireText.trim().toLowerCase();

  return (
    <dialog
      ref={ref}
      className={cx(s.dialog, surface === "paper" ? "surface-paper" : "surface-terminal", s[surface], danger && s.danger)}
      aria-labelledby={`${id}-t`}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onCancel();
      }}
      onClick={(e) => {
        if (e.target === ref.current && !busy) onCancel();
      }}
    >
      <form
        className={s.inner}
        onSubmit={(e) => {
          e.preventDefault();
          if (matches && !busy) onConfirm();
        }}
      >
        {danger && (
          <div className={s.warn} aria-hidden>
            WARNING
          </div>
        )}
        <h2 id={`${id}-t`} className={s.title}>
          {title}
        </h2>
        {body && <div className={s.body}>{body}</div>}
        {requireText && (
          <label className={s.typeWrap}>
            <span className={s.typeLabel}>
              Type <strong className={s.code}>{requireText}</strong> to confirm
            </span>
            <input
              className={s.typeInput}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              autoFocus
            />
          </label>
        )}
        <div className={s.actions}>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button type="submit" variant={danger ? "danger" : "primary"} disabled={!matches} loading={busy}>
            {confirmLabel}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
