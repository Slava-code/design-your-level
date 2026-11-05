// Append-only event feed shown on the admin Feed tab.
import "server-only";
import type { FeedType } from "@/lib/types";
import { q } from "./db";

/** Never throws: a feed write failing must not break the action that caused it. */
export async function logFeed(type: FeedType, slot: number | null, payload: Record<string, unknown> = {}): Promise<void> {
  try {
    await q("INSERT INTO feed (type, slot, payload) VALUES ($1, $2, $3::jsonb)", [type, slot, JSON.stringify(payload)]);
  } catch (e) {
    console.error("[feed] write failed:", e instanceof Error ? e.message : e);
  }
}
