// AI-layer settings. Defaults come from spike/RESULTS.md; every one can be overridden by env.

export type ImageQuality = "low" | "medium" | "high" | "xhigh" | "max";

export const MODELS = {
  text: process.env.TEXT_MODEL || "gpt-6-luna",
  image: process.env.IMAGE_MODEL || "gpt-image-2.6-flare",
};

export const IMAGE_SETTINGS = {
  quality: (process.env.IMAGE_QUALITY || "high") as ImageQuality,
  size: process.env.IMAGE_SIZE || "1536x1024",
  /** jpeg is the fastest format to encode and ~5x smaller than png for this kind of art. */
  format: "jpeg" as const,
  compression: 88,
  /** "low" (less restrictive) by default: with "auto", flare blocked 3/3 properly softened horror prompts at the
   *  output stage, while "low" rendered them as implied, PG-13 horror. See spike/RESULTS.md. */
  moderation: (process.env.IMAGE_MODERATION || "low") as "auto" | "low",
};

export const TEXT_SETTINGS = {
  /** Luna supports none|low|medium|high|xhigh|max. */
  followupEffort: (process.env.TEXT_EFFORT_FOLLOWUP || "medium") as "none" | "low" | "medium" | "high",
  promptEffort: (process.env.TEXT_EFFORT_PROMPT || "low") as "none" | "low" | "medium" | "high",
};

/** Per-attempt and overall deadlines (ms). A retry happens only if the overall deadline leaves room.
 *  Worst case of one route invocation (POST /api/generate when the follow-up call returns no questions and
 *  the pipeline goes straight on to the image): moderation 8s + follow-ups (ref fetch 15s + 45s) + prompt
 *  writer (ref fetch 15s + 45s) + image 150s (its deadline includes its own ref fetch) = 278s, inside
 *  `maxDuration = 300` (the Vercel Hobby ceiling with Fluid compute). The pipeline also enforces its own
 *  hard deadline (PIPELINE_DEADLINE_MS in src/lib/server/pipeline.ts) and marks the generation as an error
 *  itself rather than leaving it stuck. Typical: prompt 4-11s, image 9-12s (flare high), ~19s with a
 *  refusal retry. */
export const TIMEOUTS = {
  moderation: 8_000,
  text: 40_000,
  textTotal: 45_000,
  image: 120_000,
  imageTotal: 150_000,
  refFetch: 15_000,
};

export const MAX_REFS = 4;
