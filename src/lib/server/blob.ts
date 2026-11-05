// Vercel Blob paths and helpers. All paths live under `${blobNamespace()}ev<epoch>/` so Reset event
// can delete one epoch's files, and dev databases never touch production files.
import "server-only";
import { put } from "@vercel/blob";
import { blobNamespace } from "./config";

export const epochPrefix = (epoch: number) => `${blobNamespace()}ev${epoch}/`;
export const refsPrefix = (epoch: number, slot: number) => `${epochPrefix(epoch)}refs/slot${slot}/`;

const EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/gif": "gif",
};

/** Upload a generated storyboard; returns its public URL. */
export async function putGeneratedImage(epoch: number, slot: number, id: string, bytes: Uint8Array, contentType: string): Promise<string> {
  const pathname = `${epochPrefix(epoch)}gen/slot${slot}/${id}.${EXT[contentType] ?? "bin"}`;
  const res = await put(pathname, Buffer.from(bytes), {
    access: "public",
    contentType,
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 31536000,
  });
  return res.url;
}

