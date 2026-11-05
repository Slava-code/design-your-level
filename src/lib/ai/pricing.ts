// OpenAI prices used to turn returned `usage` into dollars. USD per 1M tokens, Standard tier.
//
// Sources (checked 2026-11-04):
//   https://developers.openai.com/api/docs/pricing
//   https://developers.openai.com/api/docs/models/gpt-6-luna
//   https://developers.openai.com/api/docs/models/gpt-image-2.6-flare
//   https://developers.openai.com/api/docs/models/gpt-image-2.6-sunburst
//   https://developers.openai.com/api/docs/guides/image-generation (cost section: cached input does
//   not apply to direct Images API / edits requests, so we always bill image/text input at full rate)
// Moderation (omni-moderation-latest) is free.
//
// Short-context rates only (<=272K input tokens); our prompts are a few thousand tokens.

export type TextPrice = { input: number; cachedInput: number; output: number };
export type ImagePrice = { textInput: number; imageInput: number; imageOutput: number };

export const TEXT_PRICES: Record<string, TextPrice> = {
  "gpt-6-luna": { input: 0.1, cachedInput: 0.01, output: 0.5 },
  "gpt-6.1-terra": { input: 1.0, cachedInput: 0.05, output: 5.0 },
  "gpt-6.1-sol": { input: 2.0, cachedInput: 0.1, output: 10.0 },
};

export const IMAGE_PRICES: Record<string, ImagePrice> = {
  "gpt-image-2.6-flare": { textInput: 5, imageInput: 8, imageOutput: 30 },
  "gpt-image-2.6-sunburst": { textInput: 5, imageInput: 8, imageOutput: 30 },
  "gpt-image-2.5-flare": { textInput: 5, imageInput: 8, imageOutput: 30 },
  "gpt-image-2.5-sunburst": { textInput: 5, imageInput: 8, imageOutput: 30 },
};

// Unknown model names (e.g. a TEXT_MODEL / IMAGE_MODEL override) fall back to the dearest known
// rates so budget accounting errs on the safe side.
const TEXT_FALLBACK: TextPrice = TEXT_PRICES["gpt-6.1-sol"];
const IMAGE_FALLBACK: ImagePrice = { textInput: 5, imageInput: 8, imageOutput: 30 };

const perToken = (usdPerMillion: number) => usdPerMillion / 1_000_000;
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

export type TextUsage = {
  input_tokens?: number;
  output_tokens?: number;
  input_tokens_details?: { cached_tokens?: number } | null;
};

/** Cost of one Responses API call. Output tokens include reasoning tokens (billed as output). */
export function textCostUsd(model: string, u: TextUsage | null | undefined): { usd: number; detail: Record<string, number> } {
  const p = TEXT_PRICES[model] ?? TEXT_FALLBACK;
  const input = u?.input_tokens ?? 0;
  const cached = Math.min(input, u?.input_tokens_details?.cached_tokens ?? 0);
  const output = u?.output_tokens ?? 0;
  const usd = (input - cached) * perToken(p.input) + cached * perToken(p.cachedInput) + output * perToken(p.output);
  return { usd: round6(usd), detail: { text_input_tokens: input, text_cached_tokens: cached, text_output_tokens: output, text_usd: round6(usd) } };
}

export type ImageUsage = {
  input_tokens?: number;
  output_tokens?: number;
  input_tokens_details?: { image_tokens?: number; text_tokens?: number } | null;
};

/** Cost of one Images API call (generate or edit), from the response `usage`. */
export function imageCostUsd(model: string, u: ImageUsage | null | undefined): { usd: number; detail: Record<string, number> } {
  const p = IMAGE_PRICES[model] ?? IMAGE_FALLBACK;
  const input = u?.input_tokens ?? 0;
  const imgIn = u?.input_tokens_details?.image_tokens ?? 0;
  const txtIn = u?.input_tokens_details?.text_tokens ?? Math.max(0, input - imgIn);
  const out = u?.output_tokens ?? 0;
  const usd = txtIn * perToken(p.textInput) + imgIn * perToken(p.imageInput) + out * perToken(p.imageOutput);
  return {
    usd: round6(usd),
    detail: { image_text_input_tokens: txtIn, image_image_input_tokens: imgIn, image_output_tokens: out, image_usd: round6(usd) },
  };
}

// ---------------------------------------------------------------- budget estimates (upper bounds)
// Measured 2026-11-04 (spike/RESULTS.md), gpt-image-2.6-flare/sunburst at 1536x1024: output is a fixed
// 1132 (medium) / 1353 (high) / 2459 (xhigh) tokens = $0.034 / $0.041 / $0.074; each reference image costs
// up to ~1500 image-input tokens (~$0.012, the API normalises large images, so 2048px and 4032px cost the same);
// prompt text ~600 tokens (~$0.003). The prompt-writer call is under $0.001.
const IMAGE_BASE_UPPER: Record<string, number> = { low: 0.02, medium: 0.045, high: 0.055, xhigh: 0.09, max: 0.2 };

/** Upper bound for one image call (no refs = generate, refs = edit). */
export function imageUpperUsd(quality: string, nRefs: number): number {
  const base = IMAGE_BASE_UPPER[quality] ?? IMAGE_BASE_UPPER.max;
  return round6(base + 0.005 + 0.015 * Math.max(0, Math.min(nRefs, 4)));
}

/** Upper bound for one structured text call (follow-ups or prompt writing) with refs as vision input. */
export function textUpperUsd(nRefs: number): number {
  return round6(0.003 + 0.001 * Math.max(0, Math.min(nRefs, 4)));
}
