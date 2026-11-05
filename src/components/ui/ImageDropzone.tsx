"use client";

import { useId, useRef, useState } from "react";
import { cx } from "./cx";
import s from "./ImageDropzone.module.css";

export type DropzoneItem = {
  id: string;
  /** Preview URL (object URL or blob URL). */
  url: string;
  name?: string;
  /** "uploading" dims the thumbnail and shows progress; "error" shows a red frame. Default "done". */
  status?: "uploading" | "done" | "error";
  /** 0..1, shown while uploading. */
  progress?: number;
  /** Small caption under the thumb, e.g. the field it belongs to. */
  caption?: string;
};

export type ImageDropzoneProps = {
  items: DropzoneItem[];
  /** Called with the picked/dropped/pasted image files (already filtered to accept types, capped to remaining slots). */
  onFiles: (files: File[]) => void;
  onRemove: (id: string) => void;
  /** Max number of items. Default 4. */
  max?: number;
  /** accept attribute. Default images incl. HEIC. */
  accept?: string;
  label?: string;
  hint?: string;
  disabled?: boolean;
  /** compact = single-row strip for use under a Field. */
  compact?: boolean;
  className?: string;
};

const DEFAULT_ACCEPT = "image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif";

function isImage(f: File) {
  return f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name);
}

/** Presentational picker: thumbnails with remove buttons + a drop/tap area. No upload logic. */
export function ImageDropzone({
  items,
  onFiles,
  onRemove,
  max = 4,
  accept = DEFAULT_ACCEPT,
  label = "Reference images",
  hint,
  disabled,
  compact,
  className,
}: ImageDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const id = useId();
  const remaining = Math.max(0, max - items.length);
  const full = remaining === 0;

  function take(list: FileList | File[] | null | undefined) {
    if (!list || disabled) return;
    const files = Array.from(list).filter(isImage).slice(0, remaining);
    if (files.length) onFiles(files);
  }

  return (
    <div className={cx(s.wrap, compact && s.compact, className)}>
      <div className={s.head}>
        <span className={s.label} id={`${id}-l`}>
          {label}
        </span>
        <span className={s.count}>
          {items.length}/{max}
        </span>
      </div>
      {hint && <p className={s.hint}>{hint}</p>}
      <div className={s.grid}>
        {items.map((it, i) => (
          <figure
            key={it.id}
            className={cx(s.thumb, it.status === "uploading" && s.uploading, it.status === "error" && s.err)}
            style={{ ["--i" as string]: i }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={it.url} alt={it.name ?? `Reference ${i + 1}`} />
            {it.status === "uploading" && (
              <span className={s.progress} aria-label="Uploading">
                <span style={{ width: `${Math.round((it.progress ?? 0.15) * 100)}%` }} />
              </span>
            )}
            {it.caption && <figcaption className={s.caption}>{it.caption}</figcaption>}
            <button
              type="button"
              className={s.remove}
              onClick={() => onRemove(it.id)}
              aria-label={`Remove ${it.name ?? `reference ${i + 1}`}`}
              disabled={disabled}
            >
              <span aria-hidden>&times;</span>
            </button>
          </figure>
        ))}
        {!full && (
          <button
            type="button"
            className={cx(s.drop, over && s.over)}
            disabled={disabled}
            aria-describedby={`${id}-l`}
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              if (!disabled) setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(false);
              take(e.dataTransfer.files);
            }}
            onPaste={(e) => take(e.clipboardData.files)}
          >
            <span className={s.plusBig} aria-hidden>
              +
            </span>
            <span className={s.dropText}>{over ? "Drop it" : items.length ? "Add more" : "Add image"}</span>
            {!compact && <span className={s.dropSub}>tap, drop or paste</span>}
          </button>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={remaining > 1}
        hidden
        onChange={(e) => {
          take(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
}
