// Real OpenAI implementations of the AI layer (see spike/RESULTS.md).
// index.ts is the public entry point; it calls these only when MOCK_AI !== "1".
import "server-only";
import OpenAI, { APIError, APIConnectionError, toFile } from "openai";
import type { DesignInput, QA, AiCost, PromptResult, StoryboardResult, RefImage } from "./index";
import { MODELS, IMAGE_SETTINGS, TEXT_SETTINGS, TIMEOUTS, MAX_REFS, type ImageQuality } from "./config";
import { textCostUsd, imageCostUsd, imageUpperUsd } from "./pricing";
import {
  FOLLOWUP_SYSTEM,
  FOLLOWUP_SCHEMA,
  PROMPT_SYSTEM,
  PROMPT_SCHEMA,
  designText,
  qaText,
  fallbackImagePrompt,
} from "./prompts";

type Effort = "none" | "low" | "medium" | "high";

// ---------------------------------------------------------------- client + retry

let _client: OpenAI | null = null;
function client(): OpenAI {
  if (!_client) {
    if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set");
    // Retries are handled by withRetry() so they respect our overall deadlines.
    _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0 });
  }
  return _client;
}

const QUOTA_CODES = new Set(["insufficient_quota", "billing_hard_limit_reached", "billing_not_active", "credit_balance_exhausted"]);
const isQuota = (e: unknown) =>
  e instanceof APIError && (QUOTA_CODES.has(String(e.code)) || /spend_limit|quota|billing/i.test(String(e.code ?? "")));

/** Transient = worth one retry: connection errors/timeouts, 5xx, 408/409, and 429 rate limits (not quota). */
function isTransient(e: unknown): boolean {
  if (e instanceof APIConnectionError) return true; // includes APIConnectionTimeoutError
  if (e instanceof APIError && typeof e.status === "number") {
    if (e.status >= 500 || e.status === 408 || e.status === 409) return true;
    if (e.status === 429 && !isQuota(e)) return true;
  }
  return false;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Runs `fn` with a per-attempt timeout, retrying transient failures while enough of the overall deadline
 * is left (so a retried call still fits inside the route's maxDuration). Rate limits (429, not quota) get
 * up to 3 attempts with jittered backoff, since all teams tend to press Generate in the same minute;
 * other transient errors get one retry.
 */
async function withRetry<T>(
  fn: (timeoutMs: number) => Promise<T>,
  opts: { attemptMs: number; totalMs: number; minRetryMs: number },
): Promise<T> {
  const start = Date.now();
  let attempt = 0;
  for (;;) {
    attempt++;
    const left = opts.totalMs - (Date.now() - start);
    try {
      return await fn(Math.max(1000, Math.min(opts.attemptMs, left)));
    } catch (e) {
      if (!isTransient(e)) throw e;
      const rateLimited = e instanceof APIError && e.status === 429;
      if (attempt >= (rateLimited ? 3 : 2)) throw e;
      let wait = 0;
      if (rateLimited) {
        const ra = Number((e as APIError).headers?.get?.("retry-after"));
        const base = Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 8000) : 2000 * attempt;
        wait = base + Math.floor(Math.random() * 1500); // jitter so 7 teams don't retry in lockstep
      } else if (!(e instanceof APIConnectionError)) {
        wait = 1000;
      }
      const remaining = opts.totalMs - (Date.now() - start) - wait;
      if (remaining < opts.minRetryMs) throw e;
      console.warn(`[ai] transient error, retrying (attempt ${attempt + 1}): ${describe(e)}`);
      if (wait) await sleep(wait);
    }
  }
}

/**
 * Team-facing text for an error thrown by any AI call (text model, image model, moderation), or null if
 * it isn't an OpenAI error. Used by the pipeline so a quota or rate-limit failure on the text step says
 * what happened instead of a generic "try again".
 */
export function friendlyAiError(e: unknown): string | null {
  if (isQuota(e)) return "The class AI budget has run out. Tell the presenter.";
  if (e instanceof APIConnectionError) return "The AI took too long or the connection dropped. Try again.";
  if (e instanceof APIError) {
    if (e.status === 429) return "The AI is busy right now. Wait a few seconds and try again.";
    if (e.status === 401 || e.status === 403) return "The AI service rejected our key. Tell the presenter.";
    if (typeof e.status === "number" && e.status >= 500) return "The AI service had a hiccup. Try again in a few seconds.";
  }
  return null;
}

/** True if this error means the OpenAI project's spending cap was hit (admin alert). */
export function isQuotaError(e: unknown): boolean {
  return isQuota(e);
}

function describe(e: unknown): string {
  if (e instanceof APIError) return `${e.status ?? "conn"} ${e.code ?? e.type ?? ""} ${e.message}`.slice(0, 300);
  return e instanceof Error ? e.message.slice(0, 300) : String(e).slice(0, 300);
}

// ---------------------------------------------------------------- reference images

type LoadedRef = { ref: RefImage; bytes: Uint8Array; mime: string; dataUrl: string };

function sniffMime(b: Uint8Array): string | null {
  if (b[0] === 0xff && b[1] === 0xd8) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45) return "image/webp";
  return null;
}

/**
 * Fetches reference images (Vercel Blob https URLs, or data: URLs) so both the text and the image model
 * get the bytes directly; this avoids OpenAI-side URL download failures. Unreadable refs are skipped.
 */
async function loadRefs(refs: RefImage[]): Promise<LoadedRef[]> {
  const out = await Promise.all(
    refs.slice(0, MAX_REFS).map(async (ref): Promise<LoadedRef | null> => {
      try {
        const res = await fetch(ref.url, { signal: AbortSignal.timeout(TIMEOUTS.refFetch) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const bytes = new Uint8Array(await res.arrayBuffer());
        const mime = sniffMime(bytes);
        if (!mime) throw new Error(`unsupported image type ${res.headers.get("content-type")}`);
        return { ref, bytes, mime, dataUrl: `data:${mime};base64,${Buffer.from(bytes).toString("base64")}` };
      } catch (e) {
        console.warn(`[ai] skipping reference image (${ref.field}): ${describe(e)}`);
        return null;
      }
    }),
  );
  return out.filter((x): x is LoadedRef => x !== null);
}

// ---------------------------------------------------------------- text model (Responses API)

type JsonCallResult<T> = { data: T | null; refusal: string | null; cost: AiCost; ms: number };

async function jsonCall<T>(args: {
  system: string;
  text: string;
  images: LoadedRef[];
  schemaName: string;
  schema: Record<string, unknown>;
  effort: Effort;
  model?: string;
}): Promise<JsonCallResult<T>> {
  const model = args.model ?? MODELS.text;
  const t0 = Date.now();
  const res = await withRetry(
    (timeout) =>
      client().responses.create(
        {
          model,
          instructions: args.system,
          input: [
            {
              role: "user",
              content: [
                { type: "input_text", text: args.text },
                ...args.images.map((r) => ({ type: "input_image" as const, image_url: r.dataUrl, detail: "auto" as const })),
              ],
            },
          ],
          text: { format: { type: "json_schema", name: args.schemaName, schema: args.schema, strict: true } },
          reasoning: { effort: args.effort },
          max_output_tokens: 8000,
          store: false,
        },
        { timeout },
      ),
    { attemptMs: TIMEOUTS.text, totalMs: TIMEOUTS.textTotal, minRetryMs: 20_000 },
  );
  const ms = Date.now() - t0;
  const c = textCostUsd(model, res.usage);
  const cost: AiCost = { usd: c.usd, detail: c.detail };

  let refusal: string | null = null;
  for (const item of res.output ?? []) {
    if (item.type === "message") {
      for (const part of item.content) if (part.type === "refusal") refusal = part.refusal || "refused";
    }
  }
  let data: T | null = null;
  if (!refusal && res.output_text) {
    try {
      data = JSON.parse(res.output_text) as T;
    } catch {
      console.warn(`[ai] ${args.schemaName}: unparsable output (status ${res.status})`);
    }
  }
  if (refusal) console.warn(`[ai] ${args.schemaName}: text model refused: ${refusal.slice(0, 200)}`);
  return { data, refusal, cost, ms };
}

// ---------------------------------------------------------------- public functions

export async function moderate(text: string): Promise<{ flagged: boolean; categories: string[] }> {
  const input = text.trim();
  if (!input) return { flagged: false, categories: [] };
  const res = await withRetry(
    (timeout) => client().moderations.create({ model: "omni-moderation-latest", input }, { timeout }),
    // One short attempt: moderation fails open, and it runs before POST /api/generate responds.
    { attemptMs: TIMEOUTS.moderation, totalMs: TIMEOUTS.moderation, minRetryMs: 60_000 },
  );
  const r = res.results[0];
  if (!r) return { flagged: false, categories: [] };
  // Class policy: OpenAI's `flagged` fires on ordinary horror ("it hunts you and kills anyone it catches"
  // scored violence=0.87 and was flagged), so violence/graphic violence never block here; the prompt writer
  // turns gore into implied horror and the image model's own filter is the backstop. Only the categories
  // below block. Illicit is ignored too (game weapons trip it). See spike/RESULTS.md.
  const categories = Object.entries(r.categories ?? {})
    .filter(([k, v]) => v === true && BLOCKING_CATEGORIES.has(k))
    .map(([k]) => k);
  return { flagged: categories.length > 0, categories };
}

const BLOCKING_CATEGORIES = new Set([
  "sexual",
  "sexual/minors",
  "hate",
  "hate/threatening",
  "harassment",
  "harassment/threatening",
  "self-harm",
  "self-harm/intent",
  "self-harm/instructions",
]);

export async function askFollowups(
  d: DesignInput,
  opts: { model?: string; effort?: Effort } = {},
): Promise<{ questions: string[]; cost: AiCost; ms: number }> {
  const t0 = Date.now();
  const refs = await loadRefs(d.references);
  const r = await jsonCall<{ questions: string[] }>({
    system: FOLLOWUP_SYSTEM,
    text: designText({ ...d, references: refs.map((x) => x.ref) }),
    images: refs,
    schemaName: "followup_questions",
    schema: FOLLOWUP_SCHEMA as unknown as Record<string, unknown>,
    effort: opts.effort ?? TEXT_SETTINGS.followupEffort,
    model: opts.model,
  });
  const questions = (r.data?.questions ?? [])
    .map((q) => (typeof q === "string" ? q.trim() : ""))
    .filter(Boolean)
    .slice(0, 3);
  return { questions, cost: r.cost, ms: Date.now() - t0 };
}

const DEFAULT_CAPTIONS = ["Entering the level", "The enemy encounter", "Finding the ability", "Solving the puzzle at the exit"];

export async function writeImagePrompt(
  d: DesignInput,
  qa: QA[],
  opts: { model?: string; effort?: Effort } = {},
): Promise<PromptResult> {
  const t0 = Date.now();
  const refs = await loadRefs(d.references);
  const usedRefs = refs.map((x) => x.ref);
  type Out = { image_prompt: string; panel_captions: string[]; reference_roles: string[]; changes_made: string[] };
  let r: JsonCallResult<Out>;
  try {
    r = await jsonCall<Out>({
      system: PROMPT_SYSTEM,
      text: `${designText({ ...d, references: usedRefs })}\n\n${qaText(qa)}`,
      images: refs,
      schemaName: "storyboard_prompt",
      schema: PROMPT_SCHEMA as unknown as Record<string, unknown>,
      effort: opts.effort ?? TEXT_SETTINGS.promptEffort,
      model: opts.model,
    });
  } catch (e) {
    // A 400 here (e.g. the text model's own input filter) should not kill the generation: fall back to a
    // plain template; if the content is truly unacceptable the image call returns a clean refusal.
    if (e instanceof APIError && e.status === 400) {
      console.warn(`[ai] prompt writer 400, using fallback prompt: ${describe(e)}`);
      r = { data: null, refusal: "bad_request", cost: { usd: 0, detail: {} }, ms: Date.now() - t0 };
    } else throw e;
  }
  const data = r.data;
  if (!data || typeof data.image_prompt !== "string" || data.image_prompt.trim().length < 40) {
    return {
      imagePrompt: fallbackImagePrompt({ ...d, references: usedRefs }, qa),
      panelCaptions: [...DEFAULT_CAPTIONS],
      referenceRoles: usedRefs.map((x, i) => `Image ${i + 1} = ${x.field}`),
      changesMade: ["The prompt writer could not process this design, so your text went to the artist as written."],
      cost: r.cost,
      ms: Date.now() - t0,
    };
  }
  const captions = (data.panel_captions ?? []).map((s) => String(s).trim()).slice(0, 4);
  while (captions.length < 4) captions.push(DEFAULT_CAPTIONS[captions.length]);
  return {
    imagePrompt: data.image_prompt.trim(),
    panelCaptions: captions,
    referenceRoles: (data.reference_roles ?? []).map((s) => String(s).trim()).filter(Boolean),
    changesMade: (data.changes_made ?? []).map((s) => String(s).trim()).filter(Boolean),
    cost: r.cost,
    ms: Date.now() - t0,
  };
}

export type StoryboardOptions = {
  model?: string;
  quality?: ImageQuality;
  size?: string;
  moderation?: "auto" | "low";
  /** gpt-image-2.6 only: low|medium|high (API default high). Sent only when given. */
  complexity?: "low" | "medium" | "high";
  format?: "jpeg" | "webp" | "png";
};

/** Appended on the one automatic retry after an output-stage block (those are stochastic: the same prompt
 *  passed 2 of 3 times in the spike). */
const REFUSAL_RETRY_SUFFIX =
  " Important: every character in this image is an original design that must not resemble any existing cartoon, game, comic or movie character. Keep any danger implied, with no blood, gore or injuries shown.";

export async function generateStoryboard(imagePrompt: string, refs: RefImage[], opts: StoryboardOptions = {}): Promise<StoryboardResult> {
  const model = opts.model ?? MODELS.image;
  const quality = opts.quality ?? IMAGE_SETTINGS.quality;
  const size = opts.size ?? IMAGE_SETTINGS.size;
  const format = opts.format ?? IMAGE_SETTINGS.format;
  const moderation = opts.moderation ?? IMAGE_SETTINGS.moderation;
  const t0 = Date.now();
  const ms = () => Date.now() - t0;

  let loaded: LoadedRef[];
  try {
    loaded = await loadRefs(refs);
  } catch (e) {
    return mapImageError(e, model, quality, ms()).result;
  }

  const attempt = async (prompt: string, totalMs: number): Promise<{ result: StoryboardResult; stage?: string }> => {
    try {
      const common: Record<string, unknown> = {
        model,
        prompt,
        size,
        quality,
        n: 1,
        output_format: format,
        ...(format === "png" ? {} : { output_compression: IMAGE_SETTINGS.compression }),
        ...(moderation !== "auto" ? { moderation } : {}),
        ...(opts.complexity ? { complexity: opts.complexity } : {}),
      };
      const res = await withRetry(
        async (timeout) => {
          if (loaded.length) {
            // Files are rebuilt per attempt: an Uploadable can only be consumed once.
            const image = await Promise.all(
              loaded.map((r, i) => toFile(r.bytes, `ref-${i + 1}.${r.mime.split("/")[1]}`, { type: r.mime })),
            );
            return client().images.edit({ ...common, image } as unknown as OpenAI.Images.ImageEditParamsNonStreaming, { timeout });
          }
          return client().images.generate(common as unknown as OpenAI.Images.ImageGenerateParamsNonStreaming, { timeout });
        },
        { attemptMs: TIMEOUTS.image, totalMs, minRetryMs: 60_000 },
      );
      const b64 = res.data?.[0]?.b64_json;
      const c = imageCostUsd(model, res.usage);
      const cost: AiCost = { usd: c.usd, detail: c.detail };
      if (!b64) return { result: { ok: false, refused: false, reason: "The image service returned no image. Please try again.", cost, ms: ms() } };
      const bytes = new Uint8Array(Buffer.from(b64, "base64"));
      const fmt = res.output_format ?? format;
      const contentType = fmt === "png" ? "image/png" : fmt === "webp" ? "image/webp" : "image/jpeg";
      return { result: { ok: true, bytes, contentType, cost, ms: ms() } };
    } catch (e) {
      return mapImageError(e, model, quality, ms());
    }
  };

  // The deadline covers the reference fetch above too (t0 is before loadRefs).
  const first = await attempt(imagePrompt, TIMEOUTS.imageTotal - ms());
  const r1 = first.result;
  // One automatic retry for output-stage blocks, if there is time left; input-stage blocks are deterministic.
  if (!r1.ok && r1.refused && first.stage !== "input" && ms() < TIMEOUTS.imageTotal - 60_000) {
    console.warn(`[ai] retrying once after output-stage refusal`);
    const second = await attempt(imagePrompt + REFUSAL_RETRY_SUFFIX, TIMEOUTS.imageTotal - ms());
    const r2 = second.result;
    const cost: AiCost = {
      usd: Math.round((r1.cost.usd + r2.cost.usd) * 1e6) / 1e6,
      detail: { ...prefixKeys(r1.cost.detail, "try1_"), ...r2.cost.detail, refusal_retries: 1 },
    };
    return { ...r2, cost, ms: ms() };
  }
  return r1;
}

const prefixKeys = (o: Record<string, number>, p: string) => Object.fromEntries(Object.entries(o).map(([k, v]) => [p + k, v]));

/** Blocked requests return no usage. We charge a token amount for input-stage blocks and the price of a
 *  full image for output-stage (or unknown) blocks, since the image was rendered before it was filtered. */
function refusalCharge(stage: string, quality: string): number {
  return stage === "input" ? 0.005 : imageUpperUsd(quality, 0);
}

type ErrBody = { code?: string; type?: string; message?: string; moderation_details?: { moderation_stage?: string; categories?: string[] } };

const GRAPHIC_CATS = /violence|gore|self-harm|graphic/i;
const SEXUAL_CATS = /sexual/i;

function refusalReason(cats: string[]): string {
  if (cats.some((c) => SEXUAL_CATS.test(c))) return "The image filter blocked this one. Keep it classroom-friendly and try again.";
  if (cats.some((c) => GRAPHIC_CATS.test(c)))
    return "The image filter thought this was too graphic. Keep the horror, but make the gore implied (shadows, stains, what happens off-screen) and try again.";
  return "The image filter blocked this one. This usually means a character looked too much like a famous cartoon, game or movie character, or something was very graphic. Describe your characters in more of your own words and try again.";
}

function mapImageError(e: unknown, model: string, quality: string, ms: number): { result: StoryboardResult; stage?: string } {
  if (e instanceof APIError) {
    const body = (e.error ?? {}) as ErrBody;
    const code = String(e.code ?? body.code ?? "");
    const msg = String(body.message ?? e.message ?? "");
    const blocked =
      code === "moderation_blocked" ||
      code === "content_policy_violation" ||
      (e.status === 400 && /safety system|moderation|content policy/i.test(msg));
    if (blocked) {
      const stage = body.moderation_details?.moderation_stage ?? "unknown";
      const cats = (body.moderation_details?.categories ?? []).filter(Boolean);
      const charge = refusalCharge(stage, quality);
      console.warn(`[ai] image refused (${model} ${quality}): stage=${stage} categories=${cats.join(",")} req=${e.requestID ?? ""}`);
      return {
        stage,
        result: { ok: false, refused: true, reason: refusalReason(cats), cost: { usd: charge, detail: { refused_estimate_usd: charge } }, ms },
      };
    }
    console.warn(`[ai] image error (${model} ${quality}): ${describe(e)} req=${e.requestID ?? ""}`);
    let reason = "The image service had a problem. Please try again.";
    if (isQuota(e)) reason = friendlyAiError(e)!;
    else if (e.status === 429) reason = "The image service is busy right now. Wait a few seconds and try again.";
    else if (e instanceof APIConnectionError) reason = "The image took too long or the connection dropped. Please try again.";
    else if (e.status === 401 || e.status === 403) reason = "The image service rejected our key. Tell the presenter.";
    return { result: { ok: false, refused: false, reason, cost: { usd: 0, detail: {} }, ms } };
  }
  console.warn(`[ai] image unexpected error (${model}): ${describe(e)}`);
  return { result: { ok: false, refused: false, reason: "Something went wrong making the image. Please try again.", cost: { usd: 0, detail: {} }, ms } };
}
