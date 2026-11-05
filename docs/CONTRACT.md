# Build contract (shared by everyone working on this repo)

Read SPEC.md first; it is the product spec. This file fixes the seams between parts built in parallel.

## Ground rules
- Next.js 16.4 App Router. Per AGENTS.md, read `node_modules/next/dist/docs/` for anything version-sensitive (e.g. `proxy.ts` replaced `middleware.ts`, async `params`/`cookies()`, `after()`).
- `npm install` respects `.npmrc` `before=` (13-day supply-chain rule). Never remove or bypass it; never use `--before` overrides or `npx pkg@latest`.
- Secrets live only in `.env.local` (and Vercel env). Never print, log, commit or send team codes, ADMIN_CODE, SESSION_SECRET or API keys to the client. Codes never go in the DB.
- Dev servers: each worker uses its own port and dist dir: `NEXT_DIST_DIR=.next-<name> npx next dev -p <port>`. Kill your server when done.
- `MOCK_AI=1` (server env) makes the AI layer return canned questions/prompts and a placeholder storyboard at $0 cost after a short fake delay. Use it for UI work and e2e tests. Real OpenAI calls only when a task says so (project has a hard $50/month cap shared by everything).
- Browsers: only headless Chrome/Playwright (channel "chrome", the system Chrome; no browser downloads) pointed at localhost. Never drive the user's own Chrome; never browse other sites.
- No emojis anywhere in the UI.

## File ownership
| Area | Paths |
|---|---|
| AI layer | `src/lib/ai/**`, `spike/**` |
| Backend | `db/**`, `scripts/migrate.mjs`, `src/lib/**` (except `ai/`), `src/app/api/**`, `src/proxy.ts` |
| Design system | `src/app/layout.tsx`, `src/app/globals.css`, `src/components/ui/**`, `public/fonts/**`, `src/app/styleguide/**` |
| Art | `public/art/**` |
| Team UI | `src/app/page.tsx`, `src/app/(team)/**`, `src/components/team/**` |
| Admin + projector | `src/app/admin/**`, `src/app/screen/**`, `src/components/admin/**`, `scripts/print-codes.mjs` |

## AI layer interface (`src/lib/ai/index.ts`)
```ts
export type RefImage = { url: string; field: "genre"|"feeling"|"artStyle"|"level"|"enemy"|"ability"|"puzzle"|"general" };
export type DesignInput = { genre: string; feeling: string; artStyle: string; level: string; enemy: string; ability: string; puzzle: string; references: RefImage[] };
export type QA = { q: string; a: string };
export type AiCost = { usd: number; detail: Record<string, number> };

export function moderate(text: string): Promise<{ flagged: boolean; categories: string[] }>;            // free endpoint, cost 0
export function askFollowups(d: DesignInput): Promise<{ questions: string[]; cost: AiCost; ms: number }>; // 0-3 questions
export function writeImagePrompt(d: DesignInput, qa: QA[]): Promise<{
  imagePrompt: string; panelCaptions: string[]; referenceRoles: string[]; changesMade: string[]; cost: AiCost; ms: number }>;
export function generateStoryboard(imagePrompt: string, refs: RefImage[]): Promise<
  | { ok: true; bytes: Uint8Array; contentType: string; cost: AiCost; ms: number }
  | { ok: false; refused: boolean; reason: string; cost: AiCost; ms: number }>;
export function estimateGenerationUsd(nRefs: number): number;   // conservative upper bound for reserving budget
export function estimateFollowupUsd(nRefs: number): number;
export const MODELS: { text: string; image: string };            // from env TEXT_MODEL / IMAGE_MODEL with defaults
```
All functions honour `MOCK_AI=1`. They throw only on unexpected errors; refusals are returned, not thrown.
