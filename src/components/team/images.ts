"use client";

// Reference image prep + upload.
// Resize ONLY if the long edge is over 2048 px (canvas -> JPEG q0.9). Small JPEG/PNG/WebP pass through untouched.
// HEIC/HEIF/GIF are re-encoded to JPEG when the browser can decode them (Safari can decode HEIC; Chrome cannot).
import { upload } from "@vercel/blob/client";
import { MAX_UPLOAD_BYTES } from "@/lib/types";

export const MAX_EDGE = 2048;
const PASS_TYPES = ["image/jpeg", "image/png", "image/webp"];

export class ImagePrepError extends Error {}

function isHeic(f: File) {
  return /heic|heif/i.test(f.type) || /\.(heic|heif)$/i.test(f.name);
}

async function decode(file: Blob): Promise<{ src: CanvasImageSource; w: number; h: number; close: () => void }> {
  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { src: bmp, w: bmp.width, h: bmp.height, close: () => bmp.close() };
    } catch {
      /* fall back to <img> (Safari HEIC path) */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return { src: img, w: img.naturalWidth, h: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch {
    URL.revokeObjectURL(url);
    throw new ImagePrepError(
      isHeic(file as File)
        ? "This browser can't read HEIC photos. Take a screenshot of it, or pick a JPG or PNG."
        : "That file doesn't look like an image we can read. Try a JPG or PNG.",
    );
  }
}

function toBlob(canvas: HTMLCanvasElement, type: string, q?: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new ImagePrepError("Couldn't process that image."))), type, q),
  );
}

export type Prepared = { blob: Blob; contentType: string; ext: string; resized: boolean; width: number; height: number };

/** Returns the bytes to upload. */
export async function prepareImage(file: File): Promise<Prepared> {
  const passThrough = PASS_TYPES.includes(file.type) && !isHeic(file);
  const img = await decode(file);
  try {
    const long = Math.max(img.w, img.h);
    const needsResize = long > MAX_EDGE;
    if (passThrough && !needsResize) {
      const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
      return { blob: file, contentType: file.type, ext, resized: false, width: img.w, height: img.h };
    }
    const scale = needsResize ? MAX_EDGE / long : 1;
    const w = Math.max(1, Math.round(img.w * scale));
    const h = Math.max(1, Math.round(img.h * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new ImagePrepError("Couldn't process that image.");
    ctx.fillStyle = "#ffffff"; // transparent PNG/GIF -> white, not black, in JPEG
    ctx.fillRect(0, 0, w, h);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img.src, 0, 0, w, h);
    const blob = await toBlob(canvas, "image/jpeg", 0.9);
    return { blob, contentType: "image/jpeg", ext: "jpg", resized: needsResize, width: w, height: h };
  } finally {
    img.close();
  }
}

function safeBase(name: string) {
  const base = name.replace(/\.[^.]+$/, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return (base || "ref").slice(0, 40);
}

/** Prepare + upload to Vercel Blob through /api/upload. Resolves to the public blob URL. */
export async function uploadReference(
  file: File,
  uploadPrefix: string,
  onProgress?: (p: number) => void,
  signal?: AbortSignal,
): Promise<{ url: string; prepared: Prepared }> {
  const prepared = await prepareImage(file);
  if (prepared.blob.size > MAX_UPLOAD_BYTES) {
    throw new ImagePrepError("That image is too big (over 8 MB). Try a smaller one or a screenshot.");
  }
  onProgress?.(0.05);
  const pathname = `${uploadPrefix}${safeBase(file.name)}.${prepared.ext}`;
  try {
    const res = await upload(pathname, prepared.blob, {
      access: "public",
      handleUploadUrl: "/api/upload",
      contentType: prepared.contentType,
      abortSignal: signal,
      onUploadProgress: (e) => onProgress?.(Math.max(0.05, Math.min(1, e.percentage / 100))),
    });
    return { url: res.url, prepared };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (/phase|Uploading/i.test(msg)) throw new ImagePrepError("Uploads are closed right now.");
    throw new ImagePrepError("Upload failed. Check your connection and try again.");
  }
}
