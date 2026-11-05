"use client";

import { useMemo, useState } from "react";
import type { FeedItem, FeedType } from "@/lib/types";
import { ago, clock, describeFeed, teamLabel } from "./lib";
import s from "./admin.module.css";

const FILTERS: { id: string; label: string; types: FeedType[] | null }[] = [
  { id: "all", label: "Everything", types: null },
  { id: "gen", label: "Generations", types: ["asked", "generated", "refused", "error", "flagged", "cancelled"] },
  { id: "problems", label: "Problems", types: ["refused", "error", "flagged"] },
  { id: "teams", label: "Joins and names", types: ["joined", "renamed"] },
  { id: "subs", label: "Submits and votes", types: ["submitted", "voted"] },
  { id: "admin", label: "Admin", types: ["phase", "timer", "reveal", "budget_reset", "budget_set", "event_reset"] },
];

export function FeedTab({ feed, now }: { feed: FeedItem[]; now: number }) {
  const [filter, setFilter] = useState("all");
  const types = FILTERS.find((f) => f.id === filter)?.types ?? null;
  const items = useMemo(() => {
    const list = types ? feed.filter((f) => types.includes(f.type)) : feed;
    return list.slice().reverse();
  }, [feed, types]);

  return (
    <div className={s.tabBody}>
      <div className={s.feedBar}>
        <div className={s.filterRow} role="group" aria-label="Filter events">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              className={s.filterChip}
              aria-pressed={filter === f.id}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <span className="muted">{feed.length} events · live</span>
      </div>
      {items.length === 0 ? (
        <div className={s.empty}>
          <p className={s.emptyBig}>Quiet so far</p>
          <p className="muted">Joins, follow-ups, storyboards, submissions, votes and phase changes show up here as they happen.</p>
        </div>
      ) : (
        <ol className={s.feed} aria-live="polite" aria-relevant="additions">
          {items.map((f) => {
            const d = describeFeed(f);
            const who = f.slot != null ? teamLabel(f.slot, f.teamName) : null;
            const img = f.type === "generated" && typeof f.payload?.imageUrl === "string" ? (f.payload.imageUrl as string) : null;
            return (
              <li key={f.id} className={s.feedItem} data-tone={d.tone}>
                <span className={s.feedTag}>{d.tag}</span>
                <span className={s.feedText}>
                  {who && <strong className={s.feedWho}>{who} </strong>}
                  {d.text}
                </span>
                {img && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={img} alt="" className={s.feedThumb} />
                )}
                <time className={s.feedTime} dateTime={f.ts} title={clock(f.ts)}>
                  {ago(f.ts, now)}
                </time>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
