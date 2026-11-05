# Design Your Level

Live 15-minute class activity for the ENGL 175 "Video Games and Game Design" talk (Tue 11/10, about 28 students in about 7 teams). Each team designs a game level that uses the four aspects from the talk (level, enemy, ability, puzzle). An AI asks up to 3 follow-up questions and draws a 4-panel storyboard. Teams can redraw within a budget, then submit. Each team rates 4 other designs, and the top 3 are revealed on a podium on the projector.

- `/` teams (phones and laptops): join with a 3-word code, then lobby, design, voting, reveal.
- `/admin` presenter control room: phases, timer, teams, live feed, results, reset.
- `/screen` projector view (needs the admin login in the same browser): big timer, team tiles, podium.

Product spec: `SPEC.md`. Build contract and file ownership: `docs/CONTRACT.md`. Model spike results (costs, latencies, refusal behaviour): `spike/RESULTS.md`.

## Stack

Next.js 16.4 (App Router, Turbopack) on Vercel, plain CSS modules, Neon Postgres (`@neondatabase/serverless`, HTTP), Vercel Blob (reference uploads and generated storyboards), OpenAI (moderation, `gpt-6-luna` for text, `gpt-image-2.6-flare` for images). Clients poll `GET /api/state` every 2 s; there are no websockets.

## Environment variables

Names only; values live in `.env.local` (never committed) and in the Vercel project settings. See `.env.example`.

Required in production:

| Name | What |
|---|---|
| `OPENAI_API_KEY` | Key for the OpenAI project "ENGL 175 Activity" ($50/month hard cap) |
| `TEAM_CODES` | Comma-separated 3-word codes; position in the list = Team N |
| `ADMIN_CODE` | Admin login code |
| `SESSION_SECRET` | At least 32 characters (64 hex chars from `gen-codes.mjs`); signs the session cookies |
| `DATABASE_URL` | Neon pooled connection string (database `neondb` is production) |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob store token |
| `TEAM_BUDGET_USD` | Per-team budget, default 5 |

Optional (defaults are fine): `DATABASE_URL_UNPOOLED` (used by the migrate script), `TEXT_MODEL`, `IMAGE_MODEL`, `IMAGE_QUALITY` (high), `IMAGE_SIZE` (1536x1024), `IMAGE_MODERATION` (low; `auto` is stricter but refuses ordinary horror), `TEXT_EFFORT_FOLLOWUP`, `TEXT_EFFORT_PROMPT`, `JOIN_RATE_PER_MIN` (20), `JOIN_RATE_PER_HOUR` (120), `ADMIN_RATE_PER_MIN` (5).

Development and test only, never set on Vercel production: `DEV_DB_NAME` (use a `dyl_dev_*` database), `MOCK_AI=1` (canned AI at $0), `MOCK_AI_DELAY_MS`, `ALLOW_DEV_ROUTES=1` (enables `/api/dev/*` in a local production build; ignored on Vercel), `NEXT_DIST_DIR`.

Database selection: `DEV_DB_NAME` wins. Otherwise a production build uses the database named in `DATABASE_URL`, and everything else (local dev, and Vercel preview deployments) uses `dyl_dev_backend`. Dev databases write Blob files under `dev-<db>/`, so a dev reset never touches production files.

## Local development

```bash
npm install                      # .npmrc pins resolution to packages at least 13 days old; never bypass it
node scripts/gen-codes.mjs       # first time only: fills TEAM_CODES, ADMIN_CODE, SESSION_SECRET in .env.local
node scripts/migrate.mjs         # applies db/schema.sql to all dev databases (idempotent)
MOCK_AI=1 DEV_DB_NAME=dyl_dev_backend npx next dev -p 3000
```

Open http://localhost:3000 (team), http://localhost:3000/admin and http://localhost:3000/screen. With `MOCK_AI=1` the AI is canned and free. The mock reacts to trigger words in the design text: `MOCK_REFUSE` (image refused), `MOCK_FLAG` (moderation flag), `MOCK_SOFTEN` (adds a "What we changed" note), `MOCK_CLEAR` in Level (no follow-up questions).

Several dev servers can run side by side with `NEXT_DIST_DIR=.next-<name>` and different ports. Each run adds `.next-<name>/types` lines to `tsconfig.json`; drop those before committing.

`/styleguide` and `/styleguide/podium` are dev-only component galleries (404 in production builds).

## Testing

```bash
npm run typecheck                # tsc --noEmit
npm run build:qa                 # production build into .next-qa (needed by the e2e suite)
npm run test:e2e                 # Playwright dry run (below)
```

- `e2e/dry-run.spec.ts`: the full classroom dry run against `next start` on port 3601, `MOCK_AI=1`, database `dyl_dev_qa`. One admin browser with the `/screen` tab, seven team browsers. It covers join (wrong code, forgiving input), renames, Design, a first generation with questions for every team, redraws and two resubmits, a refusal (charged), a moderation flag (not charged), a team running out of budget and the admin resetting it, ask-again plus cancel, history, timer controls, Voting (each team exactly 4 designs, never its own, each design rated exactly 4 times), the 3-step reveal on the projector, Closed, and Reset event logging every team out. It also checks that no team or admin code appears in any page or any API response. About 70 s.
- `E2E_SCREENS=1 MOCK_AI_DELAY_MS=2500 npx playwright test e2e/screens.spec.ts`: screenshots of every team state (390x844 and 1280x800), admin tab (1440x900) and projector phase (1600x900) into `test-results/screens/`.
- `E2E_REAL_AI=1 npx playwright test e2e/real-ai.spec.ts`: one real run (real OpenAI and Blob, about $0.11): reference upload, follow-up questions, storyboard, one redraw. It checks that the team's spend equals the summed generation costs, saves the images to `test-results/real/`, then resets the dev event.
- `scripts/smoke.mjs`: API smoke test against a running dev server (see the header of the file).

The Playwright config refuses any database not named `dyl_dev_*` and any `mottonote.app` URL. It uses the system Chrome (`channel: "chrome"`), so it never downloads a browser. Codes are read from `.env.local` and never printed.

## Deploy (Vercel)

1. Vercel project settings: add the production environment variables above. Do not set `DEV_DB_NAME`, `MOCK_AI` or `ALLOW_DEV_ROUTES` for Production.
2. Migrate the production database once (the default `node scripts/migrate.mjs` only touches dev databases):
   ```bash
   node scripts/migrate.mjs --prod
   ```
3. Deploy (`vercel --prod`, or push to the production branch) and attach `play.mottonote.app` to the project.
4. Smoke check on the live site: log in at `/admin`, open `/screen`, join with one code on a phone, then use Reset event.

Function limits: every API route runs on the Node.js runtime. Generation work runs in `after()` with `maxDuration = 300` on `/api/generate` and `/api/generate/[id]/answers`, which is the Vercel Hobby ceiling with Fluid compute (default and maximum are both 300 s, checked 2026-11-05). The AI layer's own deadlines keep a worst-case generation under about 280 s (moderation is a single 8 s attempt and fails open), and the pipeline marks a generation as an error itself at 285 s. A typical one takes 20-25 s. Anything stuck longer than 6 minutes is marked as an error by a sweeper, and its budget reservation is released.

## Day-of runbook (Tue 11/10)

Before class:
1. If anything was tested on the live site, log in at `/admin` and go to Controls, then Reset event (type RESET). Every team is logged out, and all generations, votes, uploads and spend are wiped. The codes stay the same, so printed cards keep working.
2. Print the code cards: `node scripts/print-codes.mjs`, then open `print/codes.html` and print on Letter at 100% scale with background graphics on (6 cards per page). Re-run it if `gen-codes.mjs --force` was ever used. `public/qr-play.svg` is the QR for the deck.
3. On the presenting laptop, log in at `/admin`, press "Open projector" and screen-share or move the `/screen` tab to the projector. The OpenAI project cap is $50/month; the whole class should cost about $3-5.

During the activity (Controls tab):
1. Lobby: hand out one card per team and tell each team to pick one typist (drafts live on that one device; teammates can follow along with the same code). Team tiles appear on the projector as teams join.
2. "Start designing" (default 8:00). Use the Timer panel (-1:00, +0:30, +1:00, +2:00, Set, Clear) as needed. The timer is only a display: phases change only when you press the button. Watch the Teams and Feed tabs. If a team runs out of budget, use Reset budget on its row (its work is kept).
3. "Start voting" (default 4:00). Submissions freeze, and each team gets up to 4 other designs to rate, anonymously. Teams with a storyboard but no submission see a "Not submitted yet" banner (it pulses in the last minute); their designs are not rated.
4. "Go to the podium", then press the big "Reveal 3rd place", "Reveal 2nd place" and "Reveal the winner" button (a double click never skips a place; "Undo one step" is in the Podium panel). The projector follows within about 2 s. The Results tab hides the ranking behind a spoiler button.
5. "End and show the gallery": a thanks screen with every submitted storyboard. Pressing it before the winner is revealed asks for confirmation.

## Troubleshooting

- A team says its code doesn't work: the code is forgiving about case, spaces and dashes. Too many wrong codes from one network blocks further wrong codes for up to a minute (20 failed attempts per minute per IP by default; the whole room probably shares one IP). A correct code still gets in unless that network is far over the limit (3x, a scripted burst). Raise `JOIN_RATE_PER_MIN` if needed.
- A team got logged out: a Reset event or an expired session sends them back to the join screen. Typing the same code again returns them to the same team with all its work.
- "The image filter blocked this one": the image model refused, usually because a character looked too much like a famous one, or because of gore. The AI layer already retries once automatically. The team should describe characters in its own words and keep gore implied. Refused attempts are charged.
- "The safety filter stopped this one": the free moderation pre-check flagged the text (sexual, hate, harassment or self-harm; horror violence is allowed). Nothing is charged.
- "The class AI budget has run out": the OpenAI project hit its monthly cap (the admin Feed shows "OPENAI QUOTA HIT"). Raise the cap in the OpenAI dashboard, or switch to the paper fallback.
- "The AI is busy right now": OpenAI rate-limited the request even after 3 attempts with backoff. Wait a few seconds and redraw.
- The projector shows "Log in at /admin": the `/screen` tab needs the admin cookie from the same browser. Log in at `/admin` there and reload.
- The site is down or slow: use the paper fallback in `SPEC.md`.
- Logs: Vercel project, then Logs. Server errors are logged with `[api]`, `[pipeline]` or `[ai]` prefixes. Codes and keys are never logged.
