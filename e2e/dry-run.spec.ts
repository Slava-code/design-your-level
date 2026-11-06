// Full classroom dry run against a production build (next start) in MOCK_AI mode.
// One admin browser (with the /screen projector tab in the same context, as in class) and seven team
// browsers drive every phase through the real UI. API reads are used only to check invariants.
//
// Run: NEXT_DIST_DIR=.next-qa npm run build && npm run test:e2e   (see playwright.config.ts)
// It RESETS the event in the dev database it runs against. Codes come from env and are never printed.
import { test, expect, type Browser, type BrowserContext, type Page, type APIRequestContext } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const CODES = (process.env.TEAM_CODES || "").split(",").map((s) => s.trim()).filter(Boolean);
const ADMIN = process.env.ADMIN_CODE || "";
const N = 7;
const SHOTS = process.env.E2E_SHOTS || ""; // optional: write screenshots of key states here

const PHONE = { width: 390, height: 844 };
const LAPTOP = { width: 1280, height: 800 };
const NAMES: Record<number, string | null> = { 1: "Ink Rats", 2: "Night Shift", 3: "Ghost Lamp", 4: "Clockwork", 5: null, 6: null, 7: null };
const RENAME_2 = "Night Owls";

type Team = { slot: number; ctx: BrowserContext; page: Page; name: string; errors: string[] };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getJson(req: APIRequestContext, url: string) {
  const r = await req.get(url);
  expect(r.ok(), `GET ${url} -> ${r.status()}`).toBeTruthy();
  return r.json();
}
async function postJson(req: APIRequestContext, url: string, data: unknown) {
  const r = await req.post(url, { data });
  const body = await r.json().catch(() => null);
  expect(r.ok(), `POST ${url} -> ${r.status()} ${body?.code ?? ""}`).toBeTruthy();
  return body;
}

/** Every API response any browser sees is scanned for codes (team codes, admin code). */
let apiResponsesScanned = 0;
const leaks: string[] = [];
function watchApi(page: Page) {
  page.on("response", async (res) => {
    if (!res.url().includes("/api/")) return;
    const body = await res.text().catch(() => "");
    apiResponsesScanned++;
    for (const c of [...CODES, ADMIN]) if (c && body.includes(c)) leaks.push(new URL(res.url()).pathname);
  });
}

function watchErrors(page: Page, sink: string[]) {
  watchApi(page);
  page.on("pageerror", (e) => sink.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    // Expected: the deliberate wrong-code 401 and the 4xx a failed join/vote reports in the network log.
    if (/status of 40[0-9]|favicon/.test(t)) return;
    sink.push(`console: ${t}`);
  });
}

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await sleep(300);
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}

/** On phones the design view has Design / Storyboard tabs; on laptops both columns show and the tabs are hidden. */
async function showTab(page: Page, name: "Design" | "Storyboard") {
  const tab = page.getByRole("tab", { name: new RegExp(`^${name}`) });
  if (await tab.isVisible().catch(() => false)) await tab.click();
}

const field = (page: Page, label: string) => page.getByRole("textbox", { name: label, exact: true });

async function fillDesign(t: Team) {
  const p = t.page;
  await showTab(p, "Design");
  await p.locator("label", { has: p.getByRole("radio", { name: "Horror" }) }).click();
  // Example chips insert text and then move focus into their field on the next frame; wait for that
  // before filling the next field, or the typed text would land in the chip's field.
  await p.getByRole("button", { name: "Insert example: hunted" }).click();
  await expect(field(p, "Feeling")).toBeFocused();
  await p.getByRole("button", { name: "Insert example: pixel art" }).click();
  await expect(field(p, "Art style")).toBeFocused();
  await expect(field(p, "Art style")).toHaveValue("pixel art");
  await field(p, "Level").fill(`A flooded subway station (team ${t.slot}). Room 1: ticket hall. Room 2: platform. Room 3: maintenance tunnel. Exit: the stairs up.`);
  await field(p, "Enemy").fill("A tall figure made of wet newspaper that only moves when the lights flicker.");
  await field(p, "Ability").fill("A flashlight whose beam freezes the figure in place.");
  await field(p, "Puzzle").fill("Reroute power through three fuse boxes to open the exit gate.");
}

async function firstGeneration(t: Team) {
  const p = t.page;
  await fillDesign(t);
  await p.getByRole("button", { name: /Next: questions, then draw/ }).click();
  await expect(p.getByRole("button", { name: "Draw it" })).toBeVisible({ timeout: 30_000 });
  const qs = p.locator('input[id^="qa-"]');
  await expect(qs.first()).toBeVisible();
  await qs.nth(0).fill("Dim green emergency lights, wet tiles everywhere.");
  if ((await qs.count()) > 1) await p.getByRole("button", { name: "Skip" }).nth(1).click();
  await p.getByRole("button", { name: "Draw it" }).click();
  const submit = p.getByRole("button", { name: "Submit this storyboard" });
  await expect(submit).toBeVisible({ timeout: 30_000 });
  await expect(p.getByRole("button", { name: "Open storyboard full screen" }).first()).toBeVisible();
  await submit.click();
  await expect(p.getByText("This is your entry.")).toBeVisible();
}

async function redraw(t: Team, edits: Partial<Record<"Level" | "Enemy" | "Ability" | "Puzzle", string>>) {
  const p = t.page;
  await showTab(p, "Design");
  for (const [k, v] of Object.entries(edits)) await field(p, k).fill(v!);
  await p.getByRole("button", { name: "Redraw storyboard" }).click();
}

async function teamState(t: Team) {
  return getJson(t.page.request, "/api/state?view=team");
}

/** Press the phase button (e.g. "Start voting") in the admin Controls tab. If a confirmation appears (it can, when the admin's
 *  last poll is a moment behind), confirm it. Waits until the server is in the new phase. */
async function startPhase(admin: Page, label: string, phase: string) {
  await admin.getByRole("button", { name: label }).first().click();
  const confirm = admin.getByRole("dialog").getByRole("button", { name: label });
  await expect
    .poll(async () => {
      // Short click timeout: a click that waits on a closing dialog must not block the poll itself.
      if (await confirm.isVisible().catch(() => false)) await confirm.click({ timeout: 1500 }).catch(() => {});
      return (await getJson(admin.request, "/api/state?view=admin")).phase;
    }, { timeout: 30_000 })
    .toBe(phase);
}

test.describe.configure({ mode: "serial" });
test.skip(process.env.E2E_REAL_AI === "1", "the mock dry run never runs against real AI");

test("full classroom dry run: 7 teams, admin, projector", async ({ browser }) => {
  expect(ADMIN, "ADMIN_CODE missing from env").not.toBe("");
  expect(CODES.length, "need at least 7 TEAM_CODES").toBeGreaterThanOrEqual(N);
  const allErrors: string[] = [];

  // ------------------------------------------------------------------ admin + projector (one browser, like class)
  const adminCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const admin = await adminCtx.newPage();
  watchErrors(admin, allErrors);
  await admin.goto("/admin");
  await admin.locator("#admin-code").fill("definitely-not-the-code");
  await admin.getByRole("button", { name: "Enter the control room" }).click();
  await expect(admin.locator("#admin-code-err")).toContainText("Wrong admin code");
  await admin.locator("#admin-code").fill(ADMIN);
  await admin.getByRole("button", { name: "Enter the control room" }).click();
  await expect(admin.getByRole("tab", { name: /Controls/ })).toBeVisible();

  // Start from a clean slate (API, so a failed earlier run can't block this one).
  await postJson(admin.request, "/api/admin/reset-event", { confirm: "RESET" });
  await expect(admin.getByText("Phase").first()).toBeVisible();

  const screen = await adminCtx.newPage();
  watchErrors(screen, allErrors);
  await screen.setViewportSize({ width: 1600, height: 900 });
  await screen.goto("/screen");
  await expect(screen.getByText("Waiting for the first team")).toBeVisible();
  await shot(screen, "screen-lobby-empty");

  // ------------------------------------------------------------------ 7 teams join through the UI
  const teams: Team[] = [];
  for (let slot = 1; slot <= N; slot++) {
    const ctx = await (browser as Browser).newContext({ viewport: slot >= 6 ? LAPTOP : PHONE });
    const page = await ctx.newPage();
    const errors: string[] = [];
    watchErrors(page, errors);
    teams.push({ slot, ctx, page, name: NAMES[slot] ?? `Team ${slot}`, errors });
  }

  await Promise.all(
    teams.map(async (t) => {
      const p = t.page;
      await p.goto("/");
      await expect(p.getByLabel("Your team code")).toBeVisible();
      if (t.slot === 1) {
        await p.getByLabel("Your team code").fill("not a real code");
        await p.getByRole("button", { name: "Join" }).click();
        await expect(p.locator("#team-code-err")).toContainText("doesn't match");
        // Forgiving input: uppercase, spaces instead of hyphens, stray whitespace.
        await p.getByLabel("Your team code").fill(`  ${CODES[0].replace(/-/g, " ").toUpperCase()} `);
      } else {
        await p.getByLabel("Your team code").fill(CODES[t.slot - 1]);
      }
      await p.getByRole("button", { name: "Join" }).click();
      await expect(p.getByText(`Team ${t.slot}`, { exact: true })).toBeVisible();
      if (NAMES[t.slot]) await p.getByLabel("Pick a team name").fill(NAMES[t.slot]!);
      await p.getByRole("button", { name: "Let's go" }).click();
      await expect(p.getByText("Waiting for the host to start")).toBeVisible();
    }),
  );
  await shot(teams[0].page, "team-lobby");

  // Rename later from the header (team 2).
  {
    const p = teams[1].page;
    await p.getByRole("button", { name: /Tap to rename/ }).click();
    await p.locator("#rename").fill(RENAME_2);
    await p.getByRole("button", { name: "Save" }).click();
    await expect(p.getByRole("button", { name: new RegExp(`Team name: ${RENAME_2}`) })).toBeVisible();
    teams[1].name = RENAME_2;
  }

  // Projector lobby lists every team by name; no code appears anywhere.
  const strip = screen.getByRole("region", { name: "Teams that joined" });
  for (const t of teams) await expect(strip.getByText(t.name, { exact: true })).toBeVisible();
  await expect(strip).toContainText(`${N}`);
  await shot(screen, "screen-lobby");

  // ------------------------------------------------------------------ DESIGN
  await startPhase(admin, "Start designing", "DESIGN");
  for (const t of teams) await expect(t.page.getByRole("heading", { name: "Build your level" })).toBeVisible();
  await expect(screen.getByRole("heading", { name: "Design your level" })).toBeVisible();
  await expect(screen.getByText(`0 of ${N} submitted`)).toBeVisible();

  // Validation: drawing with an empty form points at the missing fields.
  {
    const p = teams[6].page;
    await p.getByRole("button", { name: /Next: questions, then draw/ }).click();
    await expect(p.getByText("Needed. A short line is fine.").first()).toBeVisible();
  }

  // Every team: first generation (with follow-up questions), then submit.
  await Promise.all(teams.map((t) => firstGeneration(t)));
  await expect(screen.getByText(`${N} of ${N} submitted`)).toBeVisible();
  await shot(screen, "screen-design-all-submitted");

  // Every team's first generation asked questions and nothing was charged in mock mode.
  for (const t of teams) {
    const st = await teamState(t);
    expect(st.generations).toHaveLength(1);
    expect(st.generations[0].askedQuestions).toBe(true);
    expect(st.generations[0].status).toBe("done");
    expect(st.submittedGenerationId).toBe(st.generations[0].id);
  }

  // Timer controls (admin UI), checked against the server's phaseEndsAt.
  const remaining = async () => {
    const st = await getJson(admin.request, "/api/state?view=admin");
    return st.phaseEndsAt ? (Date.parse(st.phaseEndsAt) - Date.parse(st.serverNow)) / 1000 : null;
  };
  const r0 = (await remaining())!;
  expect(r0).toBeGreaterThan(400);
  await admin.getByRole("button", { name: "+1:00" }).click();
  await expect.poll(remaining).toBeGreaterThan(r0 + 50);
  await admin.getByLabel("Countdown length (m:ss)").fill("5:00");
  await admin.getByRole("button", { name: "Set", exact: true }).click();
  await expect.poll(async () => Math.round((await remaining()) ?? 0)).toBeLessThanOrEqual(300);
  await expect.poll(async () => Math.round((await remaining()) ?? 0)).toBeGreaterThan(290);
  await admin.getByRole("button", { name: "-1:00" }).click();
  await expect.poll(async () => Math.round((await remaining()) ?? 0)).toBeLessThanOrEqual(240);

  // Pause freezes the countdown everywhere; Resume continues from the same time.
  const pausedMs = async () => (await getJson(admin.request, "/api/state?view=admin")).timerPausedMs as number | null;
  await admin.getByRole("button", { name: "Pause", exact: true }).click();
  await expect.poll(remaining).toBeNull();
  await expect.poll(pausedMs).toBeGreaterThan(200_000);
  await expect(screen.getByRole("timer", { name: /paused/i }).first()).toBeVisible();
  await expect(teams[0].page.getByRole("timer", { name: /paused/i }).first()).toBeVisible();
  const frozen = (await pausedMs())!;
  await admin.waitForTimeout(2500);
  expect(await pausedMs()).toBe(frozen);
  await admin.getByRole("button", { name: "Resume", exact: true }).click();
  await expect.poll(pausedMs).toBeNull();
  await expect.poll(async () => Math.round((await remaining()) ?? 0)).toBeGreaterThan(Math.round(frozen / 1000) - 5);

  // End now jumps to 0:00 (with a confirm) without changing the phase.
  await admin.getByRole("button", { name: "End now", exact: true }).click();
  await admin.getByRole("dialog").getByRole("button", { name: "End now" }).click();
  await expect.poll(async () => Math.round((await remaining()) ?? 99)).toBeLessThanOrEqual(0);
  expect((await getJson(admin.request, "/api/state?view=admin")).phase).toBe("DESIGN");

  // After End now the panel offers a fresh countdown; Remove clears a running one.
  await admin.getByLabel("Countdown length (m:ss)").fill("6:00");
  await admin.getByRole("button", { name: "Start", exact: true }).click();
  await expect.poll(async () => Math.round((await remaining()) ?? 0)).toBeGreaterThan(350);
  await admin.getByRole("button", { name: "Remove", exact: true }).click();
  await expect.poll(remaining).toBeNull();
  await admin.getByLabel("Countdown length (m:ss)").fill("6:00");
  await admin.getByRole("button", { name: "Start", exact: true }).click();
  await expect.poll(async () => Math.round((await remaining()) ?? 0)).toBeGreaterThan(350);
  await expect(screen.getByRole("timer", { name: /^[56] minutes/ }).first()).toBeVisible();

  // Regenerations, in parallel across teams.
  const t1 = teams[0], t2 = teams[1], t3 = teams[2], t4 = teams[3], t5 = teams[4], t6 = teams[5], t7 = teams[6];
  await Promise.all([
    // Teams 1 and 2: redraw and resubmit the new version.
    ...[t1, t2].map(async (t) => {
      await redraw(t, { Level: `A flooded subway station (team ${t.slot}), now with a collapsed ceiling in room 2.` });
      const again = t.page.getByRole("button", { name: "Submit this one instead" });
      await expect(again).toBeVisible({ timeout: 30_000 });
      await again.click();
      await expect(t.page.getByText("This is your entry.")).toBeVisible();
    }),
    // Team 3: the image model refuses; the attempt is charged.
    (async () => {
      await redraw(t3, { Puzzle: "Reroute power through three fuse boxes. MOCK_REFUSE" });
      await expect(t3.page.getByRole("heading", { name: "The artist wouldn't draw this version" })).toBeVisible({ timeout: 30_000 });
      await expect(t3.page.getByText(/This attempt used 1 credit/)).toBeVisible();
      await shot(t3.page, "team-refused");
      await t3.page.getByRole("button", { name: "Back to editing" }).click();
      await field(t3.page, "Puzzle").fill("Reroute power through three fuse boxes to open the exit gate.");
    })(),
    // Team 4: moderation flags the text; nothing is charged.
    (async () => {
      const before = (await teamState(t4)).team.spendUsd;
      await redraw(t4, { Puzzle: "Reroute power through three fuse boxes. MOCK_FLAG" });
      await expect(t4.page.getByRole("heading", { name: "The safety filter stopped this one" })).toBeVisible({ timeout: 30_000 });
      await expect(t4.page.getByText("Nothing was charged.")).toBeVisible();
      const st = await teamState(t4);
      expect(st.generations[0].status).toBe("flagged");
      expect(st.team.spendUsd).toBe(before);
      expect(st.team.reservedUsd).toBe(0);
      await t4.page.getByRole("button", { name: "Back to editing" }).click();
      await field(t4.page, "Puzzle").fill("Reroute power through three fuse boxes to open the exit gate.");
    })(),
    // Team 6: the prompt writer softens something; "What we changed" lists it.
    (async () => {
      await redraw(t6, { Enemy: "A tall figure made of wet newspaper. MOCK_SOFTEN" });
      await expect(t6.page.getByRole("heading", { name: "What we changed" })).toBeVisible({ timeout: 30_000 });
      await expect(t6.page.getByText("Made the gore implied instead of shown")).toBeVisible();
      await shot(t6.page, "team-softened-laptop");
    })(),
    // Team 7: asks for questions again, then cancels; reopens version 1 from the history.
    (async () => {
      await showTab(t7.page, "Design");
      await t7.page.getByLabel("Ask me questions again").check();
      await t7.page.getByRole("button", { name: /Next: questions, then draw/ }).click();
      await expect(t7.page.getByRole("button", { name: "Draw it" })).toBeVisible({ timeout: 30_000 });
      await t7.page.getByRole("button", { name: "Never mind, back to editing" }).click();
      await expect(t7.page.getByRole("heading", { name: "Build your level" })).toBeVisible();
      await t7.page.getByRole("button", { name: /^Version 1/ }).click();
      await expect(t7.page.getByText("This is your entry.")).toBeVisible();
    })(),
  ]);

  // Team 5: runs out of budget, the admin resets its budget, and it can draw again.
  {
    await postJson(admin.request, "/api/dev/team-budget", { slot: 5, budgetUsd: 0.13 }); // just above one redraw estimate
    await expect.poll(async () => (await teamState(t5)).team.budgetUsd).toBe(0.13);
    await redraw(t5, { Puzzle: "Reroute power through three fuse boxes. MOCK_REFUSE" });
    await expect(t5.page.getByRole("heading", { name: "The artist wouldn't draw this version" })).toBeVisible({ timeout: 30_000 });
    await t5.page.getByRole("button", { name: "Back to editing" }).click();
    await field(t5.page, "Puzzle").fill("Reroute power through three fuse boxes to open the exit gate.");
    await expect(t5.page.getByText(/Out of credits for new drawings/)).toBeVisible();
    await expect(t5.page.getByRole("button", { name: "Redraw storyboard" })).toBeDisabled();
    await shot(t5.page, "team-out-of-budget");

    await admin.getByRole("tab", { name: /Teams/ }).click();
    const row = admin.locator("tr", { hasText: "Team 5 ·" });
    await row.getByRole("button", { name: "Reset credits" }).click();
    await admin.getByRole("dialog").getByRole("button", { name: "Reset credits" }).click();
    await expect(t5.page.getByText(/Out of credits for new drawings/)).toBeHidden();
    expect((await teamState(t5)).team.spendUsd).toBe(0);
    await t5.page.getByRole("button", { name: "Redraw storyboard" }).click();
    await expect(t5.page.getByRole("button", { name: "Submit this one instead" })).toBeVisible({ timeout: 30_000 });
    await admin.getByRole("tab", { name: /Controls/ }).click();
  }

  // Feed recorded the interesting events.
  {
    const st = await getJson(admin.request, "/api/state?view=admin");
    const types = new Set(st.feed.map((f: { type: string }) => f.type));
    for (const k of ["joined", "renamed", "asked", "generated", "refused", "flagged", "submitted", "cancelled"]) expect(types, `feed has ${k}`).toContain(k);
    const resubmits = st.feed.filter((f: { type: string; payload: { resubmit?: boolean } }) => f.type === "submitted" && f.payload.resubmit);
    expect(resubmits.length).toBe(2);
    expect(st.totals.submissions).toBe(N);
    expect(st.totals.inFlight).toBe(0);
  }

  // ------------------------------------------------------------------ VOTING
  await startPhase(admin, "Start voting", "VOTING");
  await expect(screen.getByRole("heading", { name: "Rate the design, not the art" })).toBeVisible();

  // Assignments: each team exactly 4, never its own, all different; each design rated exactly 4 times.
  const submittedBy = new Map<string, number>();
  const ownIds = new Map<number, Set<string>>();
  for (const t of teams) {
    const st = await teamState(t);
    submittedBy.set(st.submittedGenerationId, t.slot);
    ownIds.set(t.slot, new Set(st.generations.map((g: { id: string }) => g.id)));
  }
  const ratingsPerDesign = new Map<string, number>();
  const plans = new Map<number, number[]>(); // slot -> target slots in display order
  for (const t of teams) {
    const st = await teamState(t);
    expect(st.voting.total).toBe(4);
    const targets: string[] = st.voting.assigned.map((a: { target: string }) => a.target);
    expect(new Set(targets).size).toBe(4);
    for (const id of targets) {
      expect(ownIds.get(t.slot)!.has(id), `team ${t.slot} must not rate itself`).toBe(false);
      expect(submittedBy.has(id)).toBe(true);
      ratingsPerDesign.set(id, (ratingsPerDesign.get(id) ?? 0) + 1);
    }
    // Anonymous: nothing in the assignment names the author.
    expect(JSON.stringify(st.voting.assigned)).not.toContain('"slot"');
    plans.set(t.slot, targets.map((id) => submittedBy.get(id)!));
  }
  expect([...ratingsPerDesign.values()]).toEqual(Array(N).fill(4));

  // Deterministic scores so the podium is known: team 1 > team 2 > team 3 > everyone else.
  const scoreFor = (slot: number) => Math.max(1, 6 - slot);
  await Promise.all(
    teams.map(async (t) => {
      const p = t.page;
      await expect(p.getByRole("heading", { name: "Rate 4 designs" })).toBeVisible();
      const order = plans.get(t.slot)!;
      for (let i = 0; i < order.length; i++) {
        const v = scoreFor(order[i]);
        for (const k of ["Level", "Enemy", "Ability", "Puzzle"]) {
          await p
            .getByRole("group", { name: new RegExp(`^${k}`) })
            .locator("label", { has: p.getByRole("radio", { name: new RegExp(`^${v},`) }) })
            .click();
        }
        await expect(p.getByText("Saved", { exact: true })).toBeVisible({ timeout: 10_000 });
        if (i < order.length - 1) await p.getByRole("button", { name: "Next design" }).click();
      }
      await expect(p.getByText("All rated.")).toBeVisible();
      await expect.poll(async () => (await teamState(t)).voting.done).toBe(4);
    }),
  );
  await expect(screen.getByText(`${N} of ${N} teams done`)).toBeVisible();
  await shot(screen, "screen-voting-done");

  // ------------------------------------------------------------------ REVEAL
  await startPhase(admin, "Go to the podium", "REVEAL");
  await expect(screen.getByRole("heading", { name: "Who designed the best level?" })).toBeVisible();
  for (const t of teams) await expect(t.page.getByText("big screen", { exact: true })).toBeVisible();

  await admin.getByRole("button", { name: "Reveal 3rd place" }).click();
  // The projector names the place just revealed (big), then teases the next one.
  await expect(screen.getByRole("heading", { name: new RegExp(`3rd place\\s*${t3.name}`) })).toBeVisible();
  await expect(screen.getByText("And in second place...")).toBeVisible();
  // A double click must not skip a place: the reveal is conditional on the step the admin saw.
  await expect.poll(async () => (await getJson(admin.request, "/api/state?view=admin")).reveal.step).toBe(1);
  expect((await admin.request.post("/api/admin/reveal", { data: { action: "next", fromStep: 0 } })).ok()).toBeTruthy();
  expect((await getJson(admin.request, "/api/state?view=admin")).reveal.step).toBe(1);
  await expect(t3.page.getByRole("heading", { name: /3rd/ })).toBeVisible();
  await shot(screen, "screen-reveal-1");

  await admin.getByRole("button", { name: "Reveal 2nd place" }).click();
  await expect(screen.getByRole("heading", { name: new RegExp(`2nd place\\s*${t2.name}`) })).toBeVisible();
  await expect(screen.getByText("And the winner is...")).toBeVisible();
  // The winner is still a secret on the winner's own phone.
  await expect(t1.page.getByText("You won!")).toBeHidden();

  await admin.getByRole("button", { name: "Reveal the winner" }).click();
  await expect(screen.getByRole("heading", { name: new RegExp(`Winner\\s*${t1.name}`) })).toBeVisible();
  await expect(t1.page.getByText("You won!")).toBeVisible();
  await expect(admin.getByText("The winner is on screen")).toBeVisible();
  // Undo one step and reveal the winner again (exercises the "prev" path).
  const revealStep = async () => (await getJson(admin.request, "/api/state?view=admin")).reveal.step;
  await admin.getByRole("button", { name: "Undo one step" }).click();
  await expect.poll(revealStep).toBe(2);
  await admin.getByRole("button", { name: "Reveal the winner" }).click();
  await expect.poll(revealStep).toBe(3);
  await expect(admin.getByText("The winner is on screen")).toBeVisible();
  await shot(screen, "screen-reveal-winner");

  // ------------------------------------------------------------------ CLOSED
  await startPhase(admin, "End and show the gallery", "CLOSED");
  await expect(screen.getByRole("heading", { name: "What did the AI get wrong?" })).toBeVisible();
  for (const t of teams) await expect(t.page.getByText("That's a wrap")).toBeVisible();

  // No code anywhere in what the admin, projector or team browsers render.
  for (const p of [admin, screen, ...teams.map((t) => t.page)]) {
    const html = await p.content();
    for (const c of [...CODES, ADMIN]) expect(html.includes(c), "a code leaked into a page").toBe(false);
  }

  // ------------------------------------------------------------------ Reset event (admin UI) logs every team out
  await admin.getByRole("button", { name: "Reset event" }).click();
  const dlg = admin.getByRole("dialog");
  await dlg.getByRole("textbox").fill("RESET");
  await dlg.getByRole("button", { name: "Wipe everything" }).click();
  for (const t of teams) {
    await expect(t.page.getByText(/event was reset/)).toBeVisible({ timeout: 15_000 });
    await expect(t.page.getByLabel("Your team code")).toBeVisible();
  }
  await expect(screen.getByText("Waiting for the first team")).toBeVisible({ timeout: 15_000 });
  await expect(admin.getByRole("button", { name: "Start designing" })).toBeVisible();
  const after = await getJson(admin.request, "/api/state?view=admin");
  expect(after.phase).toBe("LOBBY");
  expect(after.teams).toHaveLength(0);
  expect(after.totals.totalSpendUsd).toBe(0);

  expect(apiResponsesScanned).toBeGreaterThan(100);
  expect(leaks, "API responses that contained a code").toEqual([]);

  for (const t of teams) allErrors.push(...t.errors.map((e) => `team ${t.slot}: ${e}`));
  expect(allErrors, allErrors.join("\n")).toEqual([]);

  for (const t of teams) await t.ctx.close();
  await adminCtx.close();
});
