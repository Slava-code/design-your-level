# AI model spike: results (2026-11-04)

Real calls against the "ENGL 175 Activity" OpenAI project, through the actual `src/lib/ai/openai.ts` code.
36 image calls, 25 text calls, ~10 free moderation calls. Total spend from the ledger: **$2.25** (cap was $8). That figure counts each blocked image call at our conservative refusal charge ($0.06-0.08). Spend measured from returned `usage` alone is $1.71.

## Chosen defaults

| Setting | Default | Env override | Why |
|---|---|---|---|
| Text model | `gpt-6-luna` | `TEXT_MODEL` | $0.10 / $0.50 per 1M tokens, vision + structured outputs, 2-11 s. There is no better Luna (`gpt-5.6-luna` is older). |
| Follow-up effort | `medium` | `TEXT_EFFORT_FOLLOWUP` | Sharper questions ("his silhouette, his hands, or only his shadow?") than `low`, 5-8 s. |
| Prompt-writer effort | `low` | `TEXT_EFFORT_PROMPT` | 4-11 s, faithful prompts. `medium` took 10-13 s with no visible gain. |
| Image model | `gpt-image-2.6-flare` | `IMAGE_MODEL` | ~10 s per storyboard vs ~50 s for sunburst, at the same price and near-identical quality. |
| Image quality | `high` | `IMAGE_QUALITY` | Same speed as medium, crisper. xhigh is +$0.033 and +7 s for a difference invisible at projector size. |
| Size / format | 1536x1024, JPEG q88 | `IMAGE_SIZE` | 250-480 KB per image (PNG would be ~2 MB). The docs say JPEG is also faster than PNG. |
| Image moderation | `low` | `IMAGE_MODERATION=auto` | See "Refusals" below. |

## Timings and costs

Image calls (gpt-image-2.6, 1536x1024, JPEG). Image cost comes from returned `usage`: output tokens are fixed per quality (medium 1132, high 1353 flare / 1372 sunburst, xhigh 2459) at $30/1M; image input $8/1M; text input $5/1M.

| Model | Quality | Refs | n | Wall time (median, range) | Cost per call |
|---|---|---|---|---|---|
| flare | medium | 0 | 2 | 10.5 s (10.4-10.6) | $0.036 |
| **flare** | **high** | **0** | 12 | **10.3 s (9.3-11.8)** | **$0.041-0.043** |
| flare | high, `complexity=medium` | 0 | 1 | 8.8 s | $0.043 |
| flare | xhigh | 0 | 2 | 16.9 s (16.3-17.4) | $0.076 |
| flare | high | 2 (about 1300 px) | 5 | 10.3 s (9.1-12.2) | $0.063 |
| flare | high | 2 (2048 px) | 1 | 9.3 s | $0.068 |
| flare | high | 2 (4032 px PNG, 11 MB) | 1 | 16.7 s | $0.068 |
| flare | high | 4 (2048 px) | 1 | 11.4 s | $0.092 |
| sunburst | high | 0 | 3 | 49.3 s (46.5-49.6) | $0.043 |
| sunburst | high | 2 | 1 | 49.8 s | $0.063 |
| flare | high, refused then auto-retried | 0 | 2 | 18.5 s | about $0.043 billed + refusal charge |

Text calls (gpt-6-luna, Responses API, strict `json_schema`, refs as `input_image` data URLs):

| Call | Effort | n | Wall time | Cost |
|---|---|---|---|---|
| moderation (omni-moderation-latest) | n/a | ~10 | 0.5-1.2 s | free |
| follow-ups | low | 4 | 2.7-4.9 s | $0.0001-0.0005 |
| follow-ups | medium (default) | 3 | 4.0-8.1 s | $0.0002-0.0003 |
| prompt writer | low (default) | 10 | 4.3-11.0 s | $0.0003-0.0009 |
| prompt writer | medium | 2 | 10.1-13.0 s | $0.0006 |

**Per generation** (prompt writer + image, with follow-ups on the first one): **$0.044 with no refs, about $0.065 with 2 refs, $0.093 with 4 refs.** The text calls are under 0.1 cent. Wall time from Generate to image is **about 15-22 s** (prompt 4-11 s + image 9-12 s), or about 25-30 s after an automatic refusal retry. The follow-up round adds 4-8 s before the questions appear.

**$5 per team buys about 110 generations without refs, or about 50 with 4 refs.** The 8-minute design window (maybe 5-10 generations) is the real limit, not money. The whole class costs about $3-5.

Budget estimates in `index.ts` are upper bounds: prompt writer + image + one refusal charge for the worst case (blocked, then auto-retried). With `high` that is `estimateGenerationUsd(0) = $0.123` and `estimateGenerationUsd(4) = $0.187`. `estimateFollowupUsd(n) = $0.003 + $0.001 * n`.

## Sample observations (all images in `spike/out/<design>/`, gitignored)

- **Layout:** every image (36 of 36) was a correct 2x2 grid with gutters. Panel order was right, the same protagonist and art style ran across all four panels, and the only text was small panel numbers 1-4. There was no garbled text, except one raw-text gore test (no storyboard prompt), which drew a game HUD.
- **Style adherence:** strong. The 1930s rubber-hose sepia, the watercolor storybook and the gritty sci-fi all came through clearly. "1970s film grain" came out as modern cinematic realism with a 70s set design (acceptable).
- **Flare vs sunburst:** quality is near-identical. Sunburst is slightly more cinematic (it added an escape pod to panel 4) and took more liberties with blood. Not worth 5x the wait in a live 8-minute activity.
- **Faithfulness:** the prompt writer keeps team names (The Mender, Dippy Duck, the Static Man) and their phrases, fills only gaps (protagonist look, camera, lighting) and adds no story. Follow-up questions are short and concrete: 0-3 per design, never about things already answered. The very detailed station design got 0 questions at low effort and 1 useful one at medium.
- **References:** an art-style ref plus a mood ref worked well together: the style came from the Bendy screenshot and the green glow from the deck image. **Problem found and fixed:** with a reference screenshot containing a famous character, the image model drew the team's "cardboard mascot" as Bendy (2 of 2 runs, both models). The prompt writer now describes every character concretely as "an original character" and names what to leave out of a reference in visual terms. After the fix, 2 of 2 runs drew an original mascot.

## Refusals and moderation

**Moderation pre-check.** OpenAI's default `flagged` is useless for a horror class: "it hunts you through the vents and kills anyone it catches" scored violence 0.87 and was flagged, and so was "a monster covered in blood tears through the vent" (violence/graphic 0.33). `moderate()` therefore blocks only sexual, hate, harassment and self-harm categories. Violence never blocks there: the prompt writer turns gore into implied horror, and the image filter is a (weak) backstop. Harassment also catches insults aimed at real people.

**How a refusal looks.** A blocked image call is HTTP 400 with `error.code = "moderation_blocked"`, `error.type = "image_generation_user_error"` and `error.moderation_details = { moderation_stage: "input" | "output" | "unknown", categories: [...] }`. Every block in the spike was at the **output** stage (the image was rendered, then filtered), about 10 s in. Categories seen: `violence`, and `other` for likeness to a famous cartoon character. No usage is returned, so we charge a full image ($0.06 at high) for output/unknown-stage blocks and $0.005 for input-stage blocks.

Mapping in `generateStoryboard`:
- `moderation_blocked` / `content_policy_violation` / a 400 mentioning the safety system → `{ok:false, refused:true, reason}`. The reason is a friendly, category-specific sentence for the team: graphic, likeness/other, or sexual.
- **Output-stage blocks are random** (the same prompt passed 2 of 3 times), so the AI layer **retries once automatically** with an "original characters, implied danger" suffix. In the spike that recovered 2 of 2. Input-stage blocks are not retried. The returned cost sums both attempts (`detail.refusal_retries = 1`).
- Quota/billing 429 (`insufficient_quota`, `*_spend_limit_*`) → `{ok:false, refused:false}`, "The class AI budget has run out. Tell the presenter." Not retried.
- Rate-limit 429, 5xx, 408/409, timeouts and connection errors are retried once if the deadline allows. If they still fail → `{ok:false, refused:false}` with a "try again" reason. Other 4xx (e.g. unknown model) → `{ok:false, refused:false}`.
- The text model's own refusals (a `refusal` content part) or unusable output: follow-ups return `[]`, and the prompt writer falls back to a plain template that includes "keep any violence implied". A 400 from the prompt-writer call also uses the fallback.

**Gore test** (design: "a monster covered in blood tears through the vent and rips the arm off the last survivor, guts everywhere ... severed hands on the scanner"):
- The raw design text sent straight to flare with `moderation=auto` **passed** and produced a fully graphic gore image (torn bodies, guts, a severed arm on a HUD). **The image filter alone does not protect a classroom projector.** The prompt writer's softening is the real safeguard, and it runs on every generation.
- The softened prompt (blood becomes small stains, the attack becomes a dropped helmet and a lunging shadow, severed hands become blood-stained gloves, all listed in `changes_made`), sent to flare with `moderation=auto`: **blocked 3 of 4** at the output stage (violence).
- The same softened prompt with `moderation=low`: **passed 2 of 2**, as frightening PG-13 horror with no gore. Sunburst with `auto` also passed.
- Hence the `low` default: `auto` both missed the real gore and blocked the properly softened version. The text pre-check still blocks sexual, hate and self-harm content, and the prompt writer removes them as well. Set `IMAGE_MODERATION=auto` to revert.
- The "Dippy Duck" cartoon mascot design was blocked (`other`, likeness) on about half of the first attempts, even after the original-character rule. The auto-retry recovered every one.

## Reference resize finding

The same two references were sent as simulated 10 MB phone photos (4032x2268 PNG, 5-6 MB each) and as the app's resized version (2048 px long edge, JPEG q0.9, 370-460 KB). The results were **identical image-input tokens (3016)**, so identical cost, and the outputs had equivalent style and mood adherence. The large upload made the call **7 s slower** (16.7 s vs 9.3 s), purely from upload time. The API normalises large images internally, so resizing in the browser loses nothing and saves time and Blob space. Caveat: the 4032 px files were upscaled from smaller sources, so this test shows the cost and latency equivalence; the detail equivalence is inferred from the token counts.

Reference token cost: about 1200 tokens for a 1280x720 image, about 1500 tokens for anything at or above about 2048 px (about $0.012 each).

## Prices (checked 2026-11-04; `src/lib/ai/pricing.ts`)

- gpt-6-luna: input $0.10, cached input $0.01, output $0.50 per 1M (developers.openai.com/api/docs/pricing, .../models/gpt-6-luna).
- gpt-image-2.6-flare / sunburst: text input $5, image input $8, image output $30 per 1M; cached rates do not apply to direct Images API calls (.../models/gpt-image-2.6-flare, .../gpt-image-2.6-sunburst, .../guides/image-generation).
- omni-moderation-latest: free.

## How to rerun

```sh
spike/run.sh moderate <id>                   # free
spike/run.sh followups <id> [--effort=medium]
spike/run.sh prompt <id> [--tag=v2]          # uses spike/answers/<id>.json
spike/run.sh image <id> --model=flare|sunburst --quality=high [--ptag=v2] [--moderation=low] [--refs=a.jpg,b.jpg] [--raw]
spike/run.sh spend                           # ledger total; hard cap SPEND_CAP_USD (default 8)
spike/e2e.sh <id>                            # full pipeline through src/lib/ai/index.ts with defaults (MOCK_AI=1 for $0)
```
Design ids: `station`, `inkworks`, `greenhouse`, `inkrefs` (2 references), `gore` (borderline test). Every call is logged to `spike/out/ledger.jsonl`.
