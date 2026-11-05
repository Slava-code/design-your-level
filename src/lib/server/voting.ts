// Vote assignment and ranking.
import "server-only";
import type { DesignFields, RankingEntry, RevealState, Scores } from "@/lib/types";
import type { EventRow } from "./event";

export type Assignment = { voter: number; target: number; generationId: string; position: number };

/**
 * Each voter (every joined team, submitter or not) rates up to `perVoter` submitted designs that are
 * not its own; if fewer are available, it rates all others. Designs receive as equal a number of
 * ratings as possible: submitters use a cyclic shift (exactly `perVoter` each when there are more
 * than `perVoter` submitters), then non-submitters take the least-rated designs. Deterministic.
 */
export function computeAssignments(voters: number[], submitted: { slot: number; generationId: string }[], perVoter = 4): Assignment[] {
  const subs = [...submitted].sort((a, b) => a.slot - b.slot);
  const n = subs.length;
  const count = new Map<number, number>(subs.map((s) => [s.slot, 0]));
  const out: Assignment[] = [];
  const subSlots = new Set(subs.map((s) => s.slot));

  // Submitters: voter i rates i+1 .. i+k (mod n).
  subs.forEach((v, i) => {
    const k = Math.min(perVoter, n - 1);
    for (let j = 1; j <= k; j++) {
      const t = subs[(i + j) % n];
      out.push({ voter: v.slot, target: t.slot, generationId: t.generationId, position: j });
      count.set(t.slot, (count.get(t.slot) ?? 0) + 1);
    }
  });

  // Non-submitters: least-rated first; ties rotate by voter so they spread out.
  const others = [...new Set(voters)].filter((v) => !subSlots.has(v)).sort((a, b) => a - b);
  others.forEach((v, vi) => {
    const k = Math.min(perVoter, n);
    const order = subs
      .map((s, idx) => ({ s, idx }))
      .sort((a, b) => (count.get(a.s.slot)! - count.get(b.s.slot)!) || (((a.idx - vi) % n + n) % n) - (((b.idx - vi) % n + n) % n));
    order.slice(0, k).forEach(({ s }, j) => {
      out.push({ voter: v, target: s.slot, generationId: s.generationId, position: j + 1 });
      count.set(s.slot, count.get(s.slot)! + 1);
    });
  });
  return out;
}

export type RankInput = {
  slot: number;
  name: string;
  generationId: string;
  imageUrl: string | null;
  panelCaptions: string[] | null;
  inputs: DesignFields;
  submittedAt: number;
  votes: Scores[];
};

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Score = mean of the four category means. Ties: more ratings, then earlier submission. Unrated last. */
export function computeRanking(items: RankInput[]): RankingEntry[] {
  const scored = items.map((it) => {
    if (!it.votes.length) return { it, score: null as number | null, means: null as Scores | null };
    const mean = (k: keyof Scores) => it.votes.reduce((a, v) => a + v[k], 0) / it.votes.length;
    const means = { level: mean("level"), enemy: mean("enemy"), ability: mean("ability"), puzzle: mean("puzzle") };
    const score = (means.level + means.enemy + means.ability + means.puzzle) / 4;
    return { it, score, means };
  });
  scored.sort((a, b) => {
    if (a.score == null && b.score != null) return 1;
    if (b.score == null && a.score != null) return -1;
    if (a.score != null && b.score != null && Math.abs(a.score - b.score) > 1e-9) return b.score - a.score;
    if (a.it.votes.length !== b.it.votes.length) return b.it.votes.length - a.it.votes.length;
    return a.it.submittedAt - b.it.submittedAt;
  });
  return scored.map(({ it, score, means }, i) => ({
    rank: i + 1,
    slot: it.slot,
    name: it.name,
    generationId: it.generationId,
    imageUrl: it.imageUrl,
    panelCaptions: it.panelCaptions,
    inputs: it.inputs,
    score: score == null ? null : r3(score),
    ratings: it.votes.length,
    categoryMeans: means && { level: r3(means.level), enemy: r3(means.enemy), ability: r3(means.ability), puzzle: r3(means.puzzle) },
  }));
}

export function rankingOf(event: EventRow): RankingEntry[] {
  return Array.isArray(event.ranking) ? (event.ranking as RankingEntry[]) : [];
}

/** Podium = top min(3, n) entries that have a score. Revealed lowest place first. */
export function podium(ranking: RankingEntry[]): RankingEntry[] {
  return ranking.filter((r) => r.score != null).slice(0, 3);
}

export function revealState(event: EventRow): RevealState | null {
  if (event.phase !== "REVEAL" && event.phase !== "CLOSED") return null;
  const pod = podium(rankingOf(event));
  const maxStep = pod.length;
  const step = Math.max(0, Math.min(event.reveal_step, maxStep));
  // pod is [1st, 2nd, 3rd]; step k reveals the k lowest places.
  const revealed = pod.slice(maxStep - step).reverse();
  return { step, maxStep, revealed };
}
