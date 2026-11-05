"use client";

import { useEffect, useRef, useState } from "react";
import { cx } from "@/components/ui";
import s from "./design.module.css";

const PANEL_NAMES = ["Entering", "The enemy", "The ability", "The exit"];

type Props = {
  gen: { imageUrl: string | null; panelCaptions: string[] | null };
  /** Hide captions under the image (they still show in the zoom view). */
  hideCaptions?: boolean;
  /** Smaller frame (voting). */
  small?: boolean;
  alt?: string;
  className?: string;
};

/** 2x2 storyboard in a parchment matte, numbered panels, tap to zoom full screen. */
export function Storyboard({ gen, hideCaptions, small, alt = "AI storyboard, four panels", className }: Props) {
  const [zoom, setZoom] = useState(false);
  const caps = gen.panelCaptions ?? [];
  if (!gen.imageUrl) return null;
  return (
    <figure className={cx(s.board, small && s.boardSmall, className)}>
      <button type="button" className={s.boardFrame} onClick={() => setZoom(true)} aria-label="Open storyboard full screen">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={gen.imageUrl} alt={alt} className={s.boardImg} width={1536} height={1024} />
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={cx(s.panelNum, s[`pn${i}`])} aria-hidden>
            {i + 1}
          </span>
        ))}
        <span className={s.zoomHint} aria-hidden>
          <svg viewBox="0 0 24 24" width="16" height="16">
            <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" strokeWidth="2.2" />
          </svg>
          Zoom
        </span>
      </button>
      {!hideCaptions && caps.length > 0 && <Captions caps={caps} />}
      <Lightbox open={zoom} onClose={() => setZoom(false)} src={gen.imageUrl} alt={alt} caps={caps} />
    </figure>
  );
}

export function Captions({ caps, className }: { caps: string[]; className?: string }) {
  return (
    <ol className={cx(s.caps, className)}>
      {caps.slice(0, 4).map((c, i) => (
        <li key={i} className={s.cap}>
          <span className={s.capNum}>{i + 1}</span>
          <span className={s.capBody}>
            <span className={s.capName}>{PANEL_NAMES[i]}</span>
            <span className={s.capText}>{c}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

function Lightbox({ open, onClose, src, alt, caps }: { open: boolean; onClose: () => void; src: string; alt: string; caps: string[] }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={s.lightbox}
      onClose={onClose}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      aria-label="Storyboard full screen"
    >
      {open && (
        <div className={s.lbInner}>
          <button type="button" className={s.lbClose} onClick={onClose} autoFocus>
            Close
          </button>
          <div className={s.lbScroll}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt={alt} className={s.lbImg} />
            <p className={s.lbHint}>Turn your phone sideways for a bigger view. Pinch to zoom.</p>
            {caps.length > 0 && <Captions caps={caps} className={s.lbCaps} />}
          </div>
        </div>
      )}
    </dialog>
  );
}
