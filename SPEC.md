# Design Your Level: spec

Live, 15-minute activity at the end of the ENGL 175 "Video Games and Game Design" talk (Tue 11/10). About 28 students in about 7 teams of 4. Each team designs a level that uses all four aspects from the talk (level, enemy, ability, puzzle). An AI asks one round of follow-up questions and draws a 4-panel storyboard. Teams can regenerate within a budget, then submit. Each team rates 4 other designs, and the top 3 are revealed on a podium with the winner last.

## Roles and screens

| Route | Who | What |
|---|---|---|
| `/` | Teams (phones/laptops) | Join with a code, then the phase they're in: lobby, design, voting, reveal |
| `/admin` | Slava (laptop tab) | Login with `ADMIN_CODE`. Tabs: Teams, Feed, Controls |
| `/screen` | Projector (laptop tab, screen-shared by default) | Big timer, phase, live team tiles, podium reveal. Opens only with an admin session. Never shows codes. |

Codes are never sent to any browser and never stored in the database. A code maps to a slot number (its position in `TEAM_CODES`). Everything else refers to "Team N" or the team's chosen name.

## Phases (admin-controlled)

`LOBBY → DESIGN → VOTING → REVEAL → CLOSED`. The admin can set or extend the timer for the current phase. Phases advance only when the admin clicks (the timer is a display, not a trigger). Suggested timing: 2 min explaining and handing out codes, 8 min design, 4 min voting, 1-2 min reveal.

## Team flow

1. **Join.** Type the 3-word code and click Join. The team sees "Team N" in an editable field and can rename itself (names can be changed any time before voting).
2. **Design form** (open-ended, with example hints shown as greyed placeholders or clickable chips):
   - Genre: a multiple choice (horror, puzzle, action-adventure, RPG, platformer, sci-fi, fantasy) plus "Other".
   - Feeling / atmosphere: free text (examples: hunted, uneasy, powerful, lonely, curious).
   - Art style: free text (examples: pixel art, 1930s rubber-hose cartoon, gritty 1970s sci-fi, watercolor, claymation).
   - Level, Enemy, Ability, Puzzle: free text each. The constraint is to get from the start room to the exit through 3 rooms. Each field asks "how does it create your feeling?"
   - Optional reference images on any field (up to 4 per generation in total).
3. **Follow-up round.** On the first generation, the text model asks at most 3 short questions, or none if the design is already clear. Teams answer, or skip any question. On later regenerations it goes straight to the image unless the team clicks "Ask me questions again". The checklist is below.
4. **Generate.** A loading state shows elapsed time. The result is one image with 4 panels in a 2x2 grid: (1) entering the level, (2) the enemy encounter, (3) finding the ability, (4) solving the puzzle at the exit. A collapsible "What the artist was told" section shows the final image prompt.
5. **Iterate.** Teams can edit any field and regenerate as often as their budget allows. A history strip keeps every generation, and any of them can be reopened.
6. **Submit.** Teams pick one generation and submit it. They can resubmit (pick a different one) until DESIGN ends. Whatever is submitted when VOTING starts is what gets rated.
7. **Vote.** Each team gets 4 assigned designs (round-robin over the teams that submitted, never their own; if there are 4 or fewer other submissions, they rate all of them). The design text is shown first, larger than the image ("rate the design, not the art"). Each design is scored 1-5 on Level, Enemy, Ability and Puzzle. With 7 teams, each design gets 4 ratings.
8. **Reveal.** Watched on the projector. Teams' own screens show "look up".

## AI pipeline

Models (from the project's allowed list, timed in testing before choosing):
- Text: `gpt-6-luna`.
- Image: `gpt-image-2.6-flare` or `gpt-image-2.6-sunburst`, whichever balances speed and quality. Landscape 1536x1024.

Steps for one generation:
1. **Moderation pre-check** of the raw text with OpenAI's moderation endpoint (free). This catches clearly inappropriate input before any money is spent. A flagged input shows a friendly message and does not count against the budget.
2. **Follow-ups** (first generation, or on request). Luna gets the design, the reference images (vision) and the checklist. It returns structured output: `{questions: string[] (0-3)}`.
3. **Prompt writing.** Luna gets the design, the answers and the reference images, and returns structured output: `{image_prompt, panel_captions[4], reference_roles[] (e.g. "image 2 = art style"), changes_made[]}`. Its instructions:
   - Keep the team's ideas, names and wording. Be faithful, not "improved". Add visual detail only where the team left gaps.
   - Keep horror and creepiness. This is a horror-game class: dread, monsters, darkness and implied danger are fine. Change only what would likely be refused: graphic gore becomes implied, real people become original characters, and named copyrighted characters become an original design "in the spirit of" the reference.
   - List every change in `changes_made` so the team can see what was softened.
4. **Image.** The image model gets `image_prompt` plus the reference images (edit / reference mode).
5. **Accounting.** Real cost is computed from the usage returned by each call (prices kept in `lib/pricing.ts`, checked against OpenAI's pricing page). Refused or failed image calls still count.

### Follow-up checklist (Luna asks only about the gaps, most important first)

1. Can I picture the space: size, light, materials, layout of the 3 rooms?
2. Does the enemy have a look and a behavior (how it hunts, what warns you)?
3. Where is the ability found, and what does it let you do or reach?
4. What does the puzzle look like, and what does solving it change?
5. Is it clear how each part creates the chosen feeling?
6. Is the art style concrete enough to draw?
7. Is anything contradictory, ambiguous or likely to be misread? If so, ask what they meant.

Questions must be short, concrete and answerable in one line. Never ask about something the team already answered.

### Reference images

- Uploads go straight from the browser to Vercel Blob (client upload with a server-issued token), which avoids Vercel's 4.5 MB request-body limit for functions.
- Before upload, images are resized only if the long edge exceeds 2048 px, and saved as JPEG at quality 0.9 (PNG kept if the image is small). This stays above the resolution image models work at internally, so no useful detail is lost, while 10 MB phone photos become about 1 MB. Verify in testing by generating with the original and the resized version once.
- Accepted types: JPEG, PNG, WebP, HEIC (converted in the browser). Up to 4 per generation.

## Budgets and limits

- Per team: `TEAM_BUDGET_USD` = 5. Before each call the server checks that spend plus the estimated cost fits, reserves the estimate, then reconciles it with the real cost.
- OpenAI project "ENGL 175 Activity": $50/month hard limit (requests fail with 429 once it is hit). This is the backstop. Test spend in November counts toward it too, so the admin screen shows total spend across all teams.
- Join attempts: 5 per minute per IP. Codes are compared in constant time.
- One generation in flight per team at a time.

## Admin

- **Teams tab.** Only teams that have joined at least once appear. Columns: slot (Team N), name, joined at, spend / budget, generation count, submitted (thumbnail), current activity (drafting / asking / generating / submitted). Per-team buttons: **Reset budget** (spend back to 0, keeps their work), **View** (their generations).
- **Feed tab.** A live list of events (joined, renamed, asked follow-ups, generated, refused, submitted, voted). It is refreshed by the same 2-second polling as everything else.
- **Controls tab.** Phase buttons, timer set/extend, total spend, and **Reset event**. Reset event wipes all teams, generations, uploads, votes and spend, so the dashboard is empty again. It also logs out every team by bumping a session epoch. It needs a typed confirmation and is used after testing, before class.

## Live updates

Clients poll `/api/state` every 2 s. The response contains the phase, the timer end time and the server time, so the countdown runs locally and stays in sync. Team clients also get their own state; admin and screen clients get the team list and new feed events. WebSockets aren't used: for about 9 screens, polling is simpler and works on Vercel serverless without a separate socket service.

## Architecture

- **Next.js (App Router) on Vercel**, at `play.mottonote.app`. Pages and API routes are in one project, with no separate backend or nginx.
- **Postgres** (Neon via the Vercel Marketplace) is the only store for state, with no cache.
- **Vercel Blob** holds uploaded references and generated images.
- **OpenAI** for moderation, text and images.
- Sessions use a signed httpOnly cookie `{role, slot, epoch}`, HMAC'd with `SESSION_SECRET`.

### Tables

- `event_state(id=1, phase, phase_ends_at, epoch)`
- `teams(slot PK, name, joined_at, spend_usd, budget_usd, submitted_generation_id, activity)`
- `generations(id, slot, created_at, inputs jsonb, questions jsonb, answers jsonb, image_prompt, changes_made jsonb, model_text, model_image, status [asking|generating|done|refused|error], image_url, cost_usd, ms_text, ms_image)`
- `uploads(id, slot, blob_url, field, created_at)`
- `assignments(voter_slot, target_slot)`, `votes(voter_slot, target_slot, level, enemy, ability, puzzle, created_at)`
- `feed(id, ts, type, slot, payload jsonb)`
- `join_attempts(ip, ts)`

## Environment (`.env.local`, never committed; the same keys go into Vercel)

```
OPENAI_API_KEY=      # project "ENGL 175 Activity"
TEAM_CODES=          # comma-separated 3-word codes; position = Team N
ADMIN_CODE=          # 5 words
SESSION_SECRET=      # 32 random bytes, hex
TEAM_BUDGET_USD=5
DATABASE_URL=        # from Neon
BLOB_READ_WRITE_TOKEN=
```

`scripts/gen-codes.mjs` picks words from the EFF large wordlist (7,776 words, so about 470 billion three-word combinations) with crypto randomness. It writes `TEAM_CODES` (12 codes), `ADMIN_CODE` and `SESSION_SECRET` into `.env.local`, plus `print/codes.html` (cut-out cards: "Team N" plus the code, gitignored) for printing.

## Look

Same visual system as the Phosphor and Ink deck (phosphor green `#7CFF9B` on `#06140B` for the terminal side, parchment `#E9DCBC` / ink `#1A120A` for the paper side; VT323, Special Elite, DM Serif Display, IBM Plex Sans), with more party-game energy: bigger type, bouncy transitions, a countdown that pulses in the last 10 seconds, and a podium reveal with confetti. No emojis. It works on phones first.

## Testing plan

1. Time both image models (and the text calls) on 3-4 sample designs, with and without reference images. Pick the image model and note the real cost per generation.
2. Do a full dry run with 3 browser profiles as teams and one as admin, going through every phase. Include resubmission, a refused prompt, a budget running out, and Reset budget.
3. Reset event, check the dashboard is empty, then print the codes.

## Fallback

If the site fails in class, use the small paper attendance cards: each team writes or draws its level, a few present, and the class votes by show of hands.
