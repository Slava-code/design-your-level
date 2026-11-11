// Visual walkthrough: screenshots of every team state (390x844 + 1280x800), every admin tab (1440x900)
// and every projector phase (1600x900) into test-results/screens/. Mock AI. Skipped unless E2E_SCREENS=1:
//
//   E2E_SCREENS=1 MOCK_AI_DELAY_MS=2500 npx playwright test e2e/screens.spec.ts
import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const CODES = (process.env.TEAM_CODES || "").split(",").map((s) => s.trim()).filter(Boolean);
const ADMIN = process.env.ADMIN_CODE || "";
const OUT = path.resolve(__dirname, "../test-results/screens");
const REF = path.resolve(__dirname, "../public/art/hero-corridor-diptych.jpg");
const PHONE = { width: 390, height: 844 };
const LAPTOP = { width: 1280, height: 800 };

test.skip(process.env.E2E_SCREENS !== "1", "screenshot walkthrough only with E2E_SCREENS=1");
test.skip(process.env.E2E_REAL_AI === "1", "mock only");
test.setTimeout(10 * 60_000);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let n = 0;
async function snap(page: Page, name: string, opts: { both?: boolean; full?: boolean } = {}) {
  n++;
  const id = String(n).padStart(2, "0");
  await sleep(500);
  await page.screenshot({ path: path.join(OUT, `${id}-${name}${opts.both ? "-phone" : ""}.png`), fullPage: !!opts.full });
  if (opts.both) {
    const vp = page.viewportSize()!;
    await page.setViewportSize(LAPTOP);
    await sleep(600);
    await page.screenshot({ path: path.join(OUT, `${id}-${name}-laptop.png`), fullPage: !!opts.full });
    await page.setViewportSize(vp);
    await sleep(300);
  }
}
const team = (p: Page, name: string, full = false) => snap(p, `team-${name}`, { both: true, full });

async function api(req: APIRequestContext, method: "GET" | "POST", url: string, data?: unknown) {
  const r = method === "GET" ? await req.get(url) : await req.post(url, { data: data ?? {} });
  const body = await r.json().catch(() => null);
  expect(r.ok(), `${method} ${url} -> ${r.status()} ${body?.code ?? ""}`).toBeTruthy();
  return body;
}
const field = (p: Page, label: string) => p.getByRole("textbox", { name: label, exact: true });
async function showTab(page: Page, name: "Design" | "Storyboard") {
  const tab = page.getByRole("tab", { name: new RegExp(`^${name}`) });
  if (await tab.isVisible().catch(() => false)) await tab.click();
}

async function apiTeamGenerateAndSubmit(req: APIRequestContext, slot: number) {
  const design = {
    genre: "Horror",
    feeling: ["uneasy", "lonely", "frantic"][slot % 3],
    artStyle: "watercolor storybook",
    level: `A sunken library with three reading rooms (team ${slot}).`,
    enemy: "A librarian made of moths who hears page turns.",
    ability: "A candle that makes the moths scatter.",
    puzzle: "Shelve three glowing books in the right order to open the exit.",
  };
  const g = await api(req, "POST", "/api/generate", { design, references: [], askQuestions: true });
  for (let k = 0; k < 120; k++) {
    const st = await api(req, "GET", "/api/state?view=team");
    const gen = st.generations.find((x: { id: string }) => x.id === g.generation.id);
    if (gen.status === "questions") await api(req, "POST", `/api/generate/${gen.id}/answers`, { answers: gen.questions.map(() => "dim light") });
    if (gen.status === "done") break;
    await sleep(500);
  }
  await api(req, "POST", "/api/submit", { generationId: g.generation.id });
}

test("visual walkthrough", async ({ browser }) => {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  // Admin + screen
  const adminCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const admin = await adminCtx.newPage();
  await admin.goto("/admin");
  await snap(admin, "admin-login");
  await admin.locator("#admin-code").fill(ADMIN);
  await admin.getByRole("button", { name: "Enter the control room" }).click();
  await expect(admin.getByRole("tab", { name: /Controls/ })).toBeVisible();
  await api(admin.request, "POST", "/api/admin/reset-event", { confirm: "RESET" });
  await admin.reload();
  await expect(admin.getByRole("tab", { name: /Controls/ })).toBeVisible();
  const screen = await adminCtx.newPage();
  await screen.setViewportSize({ width: 1600, height: 900 });
  await screen.goto("/screen");
  await expect(screen.getByText("Waiting for the first team")).toBeVisible();
  await snap(screen, "screen-lobby-empty");
  await snap(admin, "admin-controls-lobby");

  // Team A (the one we photograph), phone first
  const aCtx = await browser.newContext({ viewport: PHONE, deviceScaleFactor: 1 });
  const a = await aCtx.newPage();
  await a.goto("/");
  await expect(a.getByLabel("Your team code")).toBeVisible();
  await team(a, "join");
  await a.getByLabel("Your team code").fill("wrong code here");
  await a.getByRole("button", { name: "Join" }).click();
  await expect(a.locator("#team-code-err")).toBeVisible();
  await team(a, "join-error");
  await a.getByLabel("Your team code").fill(CODES[0]);
  await a.getByRole("button", { name: "Join" }).click();
  await expect(a.getByLabel("Pick a team name")).toBeVisible();
  await team(a, "name-step");
  await a.getByLabel("Pick a team name").fill("The Ink Rats");
  await a.getByRole("button", { name: "Let's go" }).click();
  await expect(a.getByText("Waiting for the host to start")).toBeVisible();
  await team(a, "lobby");

  // Other teams via API
  const others: APIRequestContext[] = [];
  const names = ["Night Shift", "Ghost Lamp with a Very Long Name", "Clockwork"];
  for (let i = 1; i <= 3; i++) {
    const c = await browser.newContext();
    await api(c.request, "POST", "/api/join", { code: CODES[i] });
    await api(c.request, "POST", "/api/team/name", { name: names[i - 1] });
    others.push(c.request);
  }
  await expect(screen.getByText("Clockwork")).toBeVisible();
  await snap(screen, "screen-lobby-teams");

  // DESIGN
  await api(admin.request, "POST", "/api/admin/phase", { phase: "DESIGN", durationSec: 480 });
  await expect(a.getByRole("heading", { name: "Build your level" })).toBeVisible();
  await team(a, "design-empty");
  await team(a, "design-empty-full", true);
  await expect(screen.getByRole("heading", { name: "Design your level" })).toBeVisible();
  await snap(screen, "screen-design-start");
  await snap(admin, "admin-controls-design");

  const otherWork = Promise.all(others.map((r, i) => apiTeamGenerateAndSubmit(r, i + 2)));

  await a.getByRole("button", { name: /Next: questions, then draw/ }).click();
  await expect(a.getByText("Needed. A short line is fine.").first()).toBeVisible();
  await team(a, "design-missing");

  await a.locator("label", { has: a.getByRole("radio", { name: "Horror" }) }).click();
  await a.getByRole("button", { name: "Insert example: hunted" }).click();
  await expect(field(a, "Feeling")).toBeFocused();
  await a.getByRole("button", { name: "Insert example: 1930s rubber-hose cartoon" }).click();
  await expect(field(a, "Art style")).toBeFocused();
  await field(a, "Level").fill("An abandoned cartoon studio. Room 1: the ink-flooded lobby. Room 2: the animation desks. Room 3: the projector booth. The exit is the back door.");
  await field(a, "Enemy").fill("A tall ink creature with a frozen grin that only moves when you are not looking at it. Dripping sounds warn you.");
  await field(a, "Ability").fill("A flickering film projector you carry that freezes the ink creature in its beam.");
  await field(a, "Puzzle").fill("Splice three film reels in the right order so the projector shows the code to the back door.");
  // Reference upload needs real Blob; ok in dev (dev namespace).
  const lvl = a.locator('[data-field="level"]');
  await lvl.getByRole("button", { name: /Add a reference image/ }).click();
  const [fc] = await Promise.all([a.waitForEvent("filechooser"), lvl.getByRole("button", { name: /Add image/ }).click()]);
  await fc.setFiles(REF);
  await a.waitForFunction(() => !document.querySelector('[aria-label="Uploading"]'), null, { timeout: 60_000 });
  await lvl.scrollIntoViewIfNeeded();
  await team(a, "design-filled");
  await team(a, "design-filled-full", true);

  await a.getByRole("button", { name: /Next: questions, then draw/ }).click();
  await expect(a.getByText("The artist is reading")).toBeVisible();
  await team(a, "asking");
  await expect(a.getByRole("button", { name: "Draw it" })).toBeVisible({ timeout: 30_000 });
  await team(a, "questions");
  const qs = a.locator('input[id^="qa-"]');
  await qs.nth(0).fill("Dim yellow work lights, wooden floors covered in ink puddles.");
  await a.getByRole("button", { name: "Skip" }).nth(1).click();
  await a.getByRole("button", { name: "Draw it" }).click();
  await expect(a.getByText("Drawing your storyboard").first()).toBeVisible();
  await sleep(2500);
  await team(a, "generating");
  await expect(a.getByRole("button", { name: "Submit this storyboard" })).toBeVisible({ timeout: 30_000 });
  await team(a, "result");
  await team(a, "result-full", true);
  await a.getByRole("button", { name: "Open storyboard full screen" }).first().click();
  await team(a, "lightbox");
  await a.getByRole("button", { name: "Close" }).click();
  await a.getByRole("button", { name: "Submit this storyboard" }).click();
  await expect(a.getByText("This is your entry.")).toBeVisible();
  await team(a, "submitted");
  await snap(screen, "screen-design-progress");

  // Softened redraw
  await showTab(a, "Design");
  await field(a, "Enemy").fill("A tall ink creature with a frozen grin. MOCK_SOFTEN Dripping sounds warn you.");
  await a.getByRole("button", { name: "Redraw storyboard" }).click();
  await expect(a.getByRole("button", { name: "Submit this one instead" })).toBeVisible({ timeout: 30_000 });
  await a.getByText("What the artist was told").click();
  await team(a, "result-v2-changes-full", true);

  // Refused + flagged
  await showTab(a, "Design");
  await field(a, "Puzzle").fill("Splice three film reels in the right order. MOCK_REFUSE");
  await a.getByRole("button", { name: "Redraw storyboard" }).click();
  await expect(a.getByRole("heading", { name: "The artist wouldn't draw this version" })).toBeVisible({ timeout: 30_000 });
  await team(a, "refused");
  await a.getByRole("button", { name: "Back to editing" }).click();
  await field(a, "Puzzle").fill("Splice three film reels in the right order. MOCK_FLAG");
  await a.getByRole("button", { name: "Redraw storyboard" }).click();
  await expect(a.getByRole("heading", { name: "The safety filter stopped this one" })).toBeVisible({ timeout: 30_000 });
  await team(a, "flagged");
  await a.getByRole("button", { name: "Back to editing" }).click();
  await field(a, "Puzzle").fill("Splice three film reels in the right order so the projector shows the code to the back door.");

  // Out of budget
  const me = (await api(a.request, "GET", "/api/state?view=team")).team;
  await api(admin.request, "POST", "/api/dev/team-budget", { slot: 1, budgetUsd: me.spendUsd + 0.05 });
  await expect(a.getByText(/Out of budget for new drawings/)).toBeVisible();
  await team(a, "out-of-budget");
  await showTab(a, "Storyboard");
  await a.getByRole("button", { name: /^Version 1/ }).click();
  await team(a, "history-v1");

  await otherWork;
  // Admin tabs during design
  await admin.getByRole("tab", { name: /Teams/ }).click();
  await snap(admin, "admin-teams");
  await admin.locator("tr", { hasText: "Team 1 ·" }).getByRole("button", { name: "View" }).click();
  await sleep(1200);
  await snap(admin, "admin-team-drawer");
  await admin.keyboard.press("Escape");
  await sleep(400);
  const closeBtn = admin.getByRole("button", { name: /Close/ });
  if (await closeBtn.first().isVisible().catch(() => false)) await closeBtn.first().click();
  await admin.getByRole("tab", { name: /Feed/ }).click();
  await snap(admin, "admin-feed");
  await admin.getByRole("tab", { name: /Results/ }).click();
  await snap(admin, "admin-results-design");
  await admin.getByRole("tab", { name: /Controls/ }).click();
  await api(admin.request, "POST", `/api/admin/team/1/reset-budget`);
  await api(admin.request, "POST", "/api/dev/team-budget", { slot: 1, budgetUsd: 5 });
  await snap(screen, "screen-design-all-submitted");

  // Final countdown on the projector
  await api(admin.request, "POST", "/api/admin/timer", { setSec: 8 });
  await sleep(2600);
  await snap(screen, "screen-design-final-countdown");
  await team(a, "design-final-seconds");
  await sleep(7000);
  await snap(screen, "screen-design-time-up");

  // VOTING
  await api(admin.request, "POST", "/api/admin/phase", { phase: "VOTING", durationSec: 240 });
  // A late team with nothing to rate
  const lateCtx = await browser.newContext({ viewport: PHONE });
  const late = await lateCtx.newPage();
  await late.goto("/");
  await late.getByLabel("Your team code").fill(CODES[4]);
  await late.getByRole("button", { name: "Join" }).click();
  await expect(late.getByRole("heading", { name: "Nothing to rate" })).toBeVisible();
  await team(late, "voting-nothing-to-rate");

  await expect(a.getByRole("heading", { name: /Rate \d designs/ })).toBeVisible();
  await team(a, "voting");
  await team(a, "voting-full", true);
  await snap(screen, "screen-voting-start");
  await snap(admin, "admin-controls-voting");
  const total = await a.locator('[aria-label="Designs to rate"] li').count();
  for (let i = 0; i < total; i++) {
    for (const [k, v] of [["Level", 4], ["Enemy", 3], ["Ability", 5], ["Puzzle", 4]] as const) {
      await a.getByRole("group", { name: new RegExp(`^${k}`) }).locator("label", { has: a.getByRole("radio", { name: new RegExp(`^${v},`) }) }).click();
    }
    await expect(a.getByText("Saved", { exact: true })).toBeVisible();
    if (i === 0) await team(a, "voting-rated-one");
    if (i < total - 1) await a.getByRole("button", { name: "Next design" }).click();
  }
  await expect(a.getByText("All rated.")).toBeVisible();
  await team(a, "voting-all-done");
  // Others vote: Team 1 best, team 2 second, team 3 third
  for (const r of others) {
    const st = await api(r, "GET", "/api/state?view=team");
    for (const x of st.voting.assigned) {
      const lv: string = x.inputs.level;
      const sc = lv.startsWith("An abandoned") ? 5 : lv.includes("(team 2)") ? 4 : lv.includes("(team 3)") ? 3 : 2;
      await api(r, "POST", "/api/vote", { target: x.target, scores: { level: sc, enemy: sc, ability: sc, puzzle: sc } });
    }
  }
  await sleep(2500);
  await snap(screen, "screen-voting-progress");
  await admin.getByRole("tab", { name: /Teams/ }).click();
  await snap(admin, "admin-teams-voting");
  await admin.getByRole("tab", { name: /Controls/ }).click();

  // REVEAL
  await api(admin.request, "POST", "/api/admin/phase", { phase: "REVEAL" });
  await expect(screen.getByRole("heading", { name: "Who designed the best level?" })).toBeVisible();
  await snap(screen, "screen-reveal-0");
  await team(a, "reveal-lookup");
  await snap(admin, "admin-controls-reveal");
  const bCtx = await browser.newContext({ viewport: PHONE });
  const b = await bCtx.newPage();
  // team 3 (third place) phone: log in with its code in a browser
  await b.goto("/");
  await b.getByLabel("Your team code").fill(CODES[2]);
  await b.getByRole("button", { name: "Join" }).click();
  for (let step = 1; step <= 3; step++) {
    await api(admin.request, "POST", "/api/admin/reveal", { action: "next" });
    await sleep(3200);
    await snap(screen, `screen-reveal-${step}`);
    if (step === 1) await team(b, "reveal-third-place");
    if (step === 2) await team(a, "reveal-before-winner");
  }
  await expect(a.getByText("You won!")).toBeVisible();
  await team(a, "reveal-winner");
  await admin.getByRole("tab", { name: /Results/ }).click();
  await snap(admin, "admin-results-reveal");

  // CLOSED
  await api(admin.request, "POST", "/api/admin/phase", { phase: "CLOSED" });
  await expect(screen.getByRole("heading", { name: "What did the AI get wrong?" })).toBeVisible();
  await sleep(1500);
  await snap(screen, "screen-closed");
  await snap(admin, "admin-results-closed");
  await team(a, "closed");
  await team(a, "closed-full", true);
  await admin.getByRole("tab", { name: /Controls/ }).click();
  await admin.getByRole("button", { name: "Reset event" }).click();
  await admin.getByRole("dialog").getByRole("textbox").fill("RESET");
  await snap(admin, "admin-reset-dialog");
  await admin.getByRole("dialog").getByRole("button", { name: "Wipe everything" }).click();
  await expect(a.getByText(/event was reset/)).toBeVisible({ timeout: 15_000 });
  await team(a, "session-expired");
  await aCtx.setOffline(true);
  await expect(a.getByText("Reconnecting")).toBeVisible({ timeout: 20_000 });
  await team(a, "reconnecting");
  await aCtx.setOffline(false);

  // Screen without admin session
  const anon = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const anonScreen = await anon.newPage();
  await anonScreen.goto("/screen");
  await sleep(1500);
  await snap(anonScreen, "screen-locked");
});
