"use client";

import { useEffect, useRef } from "react";
import s from "./Confetti.module.css";

export type ConfettiProps = {
  /** Change this value (e.g. increment a number) to fire a burst. Falsy values (0, null, "") do nothing. */
  fire?: number | string | null;
  /** Continuous gentle rain while true. */
  rain?: boolean;
  /** Pieces per burst. Default 180. */
  pieces?: number;
  /** Where bursts come from. Default "bottom" (two cannons from the lower corners). */
  origin?: "bottom" | "top" | "center";
  colors?: string[];
  /** Cover the viewport (default) or just the nearest positioned parent. */
  scope?: "viewport" | "parent";
};

const DEFAULT_COLORS = ["#7CFF9B", "#C4FFD2", "#E9DCBC", "#A67C4E", "#FFC857", "#F4F1EA", "#FF6B5B", "#1A120A"];

type P = { x: number; y: number; vx: number; vy: number; r: number; rot: number; vr: number; w: number; h: number; c: string; shape: 0 | 1 | 2; life: number };

/** Dependency-free canvas confetti. Respects prefers-reduced-motion (renders nothing). */
export function Confetti({ fire, rain = false, pieces = 180, origin = "bottom", colors = DEFAULT_COLORS, scope = "viewport" }: ConfettiProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const parts = useRef<P[]>([]);
  const raf = useRef<number | null>(null);
  const rainRef = useRef(rain);
  const colorsRef = useRef(colors);
  useEffect(() => {
    rainRef.current = rain;
    colorsRef.current = colors;
  });

  const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function size() {
    const c = canvasRef.current;
    if (!c) return { w: 0, h: 0 };
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = c.getBoundingClientRect();
    if (c.width !== Math.round(rect.width * dpr) || c.height !== Math.round(rect.height * dpr)) {
      c.width = Math.round(rect.width * dpr);
      c.height = Math.round(rect.height * dpr);
    }
    return { w: rect.width, h: rect.height, dpr };
  }

  function make(x: number, y: number, angle: number, spread: number, speed: number): P {
    const a = angle + (Math.random() - 0.5) * spread;
    const v = speed * (0.55 + Math.random() * 0.6);
    const cs = colorsRef.current;
    return {
      x,
      y,
      vx: Math.cos(a) * v,
      vy: Math.sin(a) * v,
      r: 0,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.4,
      w: 6 + Math.random() * 8,
      h: 8 + Math.random() * 10,
      c: cs[Math.floor(Math.random() * cs.length)],
      shape: (Math.random() < 0.6 ? 0 : Math.random() < 0.5 ? 1 : 2) as 0 | 1 | 2,
      life: 0,
    };
  }

  function loop() {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const { w, h, dpr = 1 } = size();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (rainRef.current && parts.current.length < 140 && Math.random() < 0.5) {
      const p = make(Math.random() * w, -20, Math.PI / 2, 0.6, 2.5);
      parts.current.push(p);
    }
    const next: P[] = [];
    for (const p of parts.current) {
      p.life++;
      p.vy += 0.16; // gravity
      p.vx *= 0.985;
      p.vy *= 0.985;
      p.x += p.vx + Math.sin(p.life / 12) * 0.6;
      p.y += p.vy;
      p.rot += p.vr;
      if (p.y < h + 40 && p.life < 900) next.push(p);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.scale(1, Math.cos(p.life / 6));
      ctx.fillStyle = p.c;
      if (p.shape === 0) ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * 0.5);
      else if (p.shape === 1) {
        ctx.beginPath();
        ctx.arc(0, 0, p.w / 2.2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.moveTo(0, -p.h / 2);
        ctx.lineTo(p.w / 2, p.h / 2);
        ctx.lineTo(-p.w / 2, p.h / 2);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }
    parts.current = next;
    if (next.length || rainRef.current) raf.current = requestAnimationFrame(loop);
    else {
      raf.current = null;
      ctx.clearRect(0, 0, w, h);
    }
  }

  function start() {
    if (raf.current == null) raf.current = requestAnimationFrame(loop);
  }

  useEffect(() => {
    if (!fire || reduced()) return;
    const { w, h } = size();
    if (!w) return;
    const scale = Math.min(1.8, Math.max(0.8, w / 1000));
    if (origin === "bottom") {
      for (let i = 0; i < pieces; i++) {
        const left = i % 2 === 0;
        parts.current.push(make(left ? -10 : w + 10, h * 0.85, left ? -Math.PI / 3.2 : -Math.PI + Math.PI / 3.2, 0.7, 19 * scale));
      }
    } else if (origin === "top") {
      for (let i = 0; i < pieces; i++) parts.current.push(make(Math.random() * w, -20 - Math.random() * h * 0.3, Math.PI / 2, 0.5, 3));
    } else {
      for (let i = 0; i < pieces; i++) parts.current.push(make(w / 2, h * 0.45, -Math.PI / 2, Math.PI * 1.6, 16 * scale));
    }
    start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fire]);

  useEffect(() => {
    if (rain && !reduced()) start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rain]);

  useEffect(
    () => () => {
      if (raf.current != null) cancelAnimationFrame(raf.current);
    },
    [],
  );

  return <canvas ref={canvasRef} className={scope === "viewport" ? s.viewport : s.parent} aria-hidden />;
}
