"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cx } from "./cx";
import s from "./Toast.module.css";

export type ToastTone = "info" | "success" | "warn" | "error";
export type ToastOptions = {
  tone?: ToastTone;
  /** Auto-dismiss after ms. Default 3800 (errors 6000). 0 = sticky. */
  durationMs?: number;
  /** Small bold line above the message. */
  title?: string;
};
type ToastItem = ToastOptions & { id: number; message: ReactNode; leaving?: boolean };

type ToastApi = {
  /** Show a toast. Returns its id. */
  show: (message: ReactNode, opts?: ToastOptions) => number;
  success: (message: ReactNode, opts?: Omit<ToastOptions, "tone">) => number;
  error: (message: ReactNode, opts?: Omit<ToastOptions, "tone">) => number;
  dismiss: (id: number) => void;
};

const Ctx = createContext<ToastApi | null>(null);

const noop: ToastApi = {
  show: () => -1,
  success: () => -1,
  error: () => -1,
  dismiss: () => {},
};

/** Access the toast API. The provider is mounted once in the root layout. */
export function useToast(): ToastApi {
  return useContext(Ctx) ?? noop;
}

/** Mounted in src/app/layout.tsx; renders the toast stack (top on phones, bottom-right on wide screens). */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const timers = useRef(new Map<number, number>());

  const dismiss = useCallback((id: number) => {
    setItems((list) => list.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    window.setTimeout(() => setItems((list) => list.filter((t) => t.id !== id)), 260);
    const tm = timers.current.get(id);
    if (tm) window.clearTimeout(tm);
    timers.current.delete(id);
  }, []);

  const show = useCallback(
    (message: ReactNode, opts: ToastOptions = {}) => {
      const id = ++seq.current;
      const tone = opts.tone ?? "info";
      const duration = opts.durationMs ?? (tone === "error" ? 6000 : 3800);
      setItems((list) => [...list.slice(-3), { ...opts, tone, id, message }]);
      if (duration > 0) timers.current.set(id, window.setTimeout(() => dismiss(id), duration));
      return id;
    },
    [dismiss],
  );

  useEffect(() => {
    const t = timers.current;
    return () => t.forEach((tm) => window.clearTimeout(tm));
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      show,
      dismiss,
      success: (m, o) => show(m, { ...o, tone: "success" }),
      error: (m, o) => show(m, { ...o, tone: "error" }),
    }),
    [show, dismiss],
  );

  return (
    <Ctx.Provider value={api}>
      {children}
      <div className={s.region} aria-live="polite" aria-relevant="additions">
        {items.map((t) => (
          <div
            key={t.id}
            className={cx(s.toast, s[t.tone ?? "info"], t.leaving && s.leaving)}
            role={t.tone === "error" ? "alert" : "status"}
          >
            <span className={s.bar} aria-hidden />
            <div className={s.content}>
              {t.title && <strong className={s.title}>{t.title}</strong>}
              <div className={s.msg}>{t.message}</div>
            </div>
            <button type="button" className={s.close} onClick={() => dismiss(t.id)} aria-label="Dismiss">
              <span aria-hidden>&times;</span>
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
