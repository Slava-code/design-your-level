// Team UI end-to-end walk-through with screenshots (headless system Chrome, MOCK_AI server).
//
//   set -a; . ./.env.local; set +a
//   BASE_URL=http://localhost:3401 SHOTS=/tmp/shots node e2e/team-flow.mjs
//
// Needs a dev server started with MOCK_AI=1 and a dev DEV_DB_NAME. It RESETS that server's event.
// Codes are read from env (TEAM_CODES / ADMIN_CODE) and never printed.
import { chromium, request } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const BASE = process.env.BASE_URL || "http://localhost:3401";
if (/mottonote\.app/.test(BASE) && process.env.E2E_ALLOW_PROD !== "1") throw new Error("Refusing to run against production.");
const SHOTS = process.env.SHOTS || path.join(os.tmpdir(), "dyl-team-shots");
const REF_SMALL = process.env.REF_SMALL || new URL("../public/art/hero-split.jpg", import.meta.url).pathname;
const REF_BIG = process.env.REF_BIG; // > 2048px test image (optional)
const CODES = (process.env.TEAM_CODES || "").split(",").map((s) => s.trim()).filter(Boolean);
const ADMIN = process.env.ADMIN_CODE;
if (!ADMIN || CODES.length < 6) throw new Error("Need ADMIN_CODE and at least 6 TEAM_CODES in env.");
fs.mkdirSync(SHOTS, { recursive: true });

const PHONE = { width: 390, height: 844 };
const DESK = { width: 1280, height: 800 };
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let n = 0;

async function api(ctx, method, url, body) {
  const res = await ctx.fetch(url, { method, data: body ?? (method === "POST" ? {} : undefined) });
  let json = null;
  try {
    json = await res.json();
  } catch {}
  if (!res.ok()) throw new Error(`${method} ${url} -> ${res.status()} ${json?.code ?? ""} ${json?.error ?? ""}`);
  return json;
}

async function shot(page, name, { both = true, full = false } = {}) {
  n += 1;
  const id = String(n).padStart(2, "0");
  await sleep(350);
  await page.screenshot({ path: path.join(SHOTS, `${id}-${name}-phone.png`), fullPage: full });
  if (both) {
    await page.setViewportSize(DESK);
    await sleep(450);
    await page.screenshot({ path: path.join(SHOTS, `${id}-${name}-desk.png`), fullPage: full });
    await page.setViewportSize(PHONE);
    await sleep(250);
  }
  log("shot", id, name);
}

async function bigText(page, name) {
  const tag = await page.addStyleTag({ content: "html{font-size:150%!important}" });
  await shot(page, name, { both: false });
  await tag.evaluate((n) => n.remove());
}

async function main() {
  const admin = await request.newContext({ baseURL: BASE });
  await api(admin, "POST", "/api/admin/login", { code: ADMIN });
  const cur = await api(admin, "GET", "/api/state?view=admin");
  if (cur.phase !== "LOBBY" || cur.teams.length) {
    // walk back to LOBBY is not needed: reset wipes everything and sets LOBBY
    await api(admin, "POST", "/api/admin/reset-event", { confirm: "RESET" });
  }
  log("event reset");

  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({ viewport: PHONE, deviceScaleFactor: 2, hasTouch: false });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !/favicon|404/.test(m.text())) errors.push(`console: ${m.text()}`);
  });

  // ------------------------------------------------------------------ join
  await page.goto(BASE + "/");
  await page.getByLabel("Your team code").waitFor();
  await shot(page, "join");
  await page.getByLabel("Your team code").fill("not a real code");
  await page.getByRole("button", { name: "Join" }).click();
  await page.getByRole("alert").waitFor();
  await shot(page, "join-wrong-code");

  // forgiving input: uppercase + spaces instead of hyphens
  const forgiving = CODES[0].replace(/-/g, " ").toUpperCase();
  await page.getByLabel("Your team code").fill(` ${forgiving} `);
  await page.getByRole("button", { name: "Join" }).click();
  await page.getByLabel("Pick a team name").waitFor();
  await shot(page, "name-step");
  await page.getByLabel("Pick a team name").fill("The Ink Rats");
  await page.getByRole("button", { name: "Let's go" }).click();
  await page.getByText("Waiting for the host to start").waitFor();
  await shot(page, "lobby");

  // rename from header
  await page.getByRole("button", { name: /Tap to rename/ }).click();
  await page.locator("#rename").fill("Ink Rats");
  await page.getByRole("button", { name: "Save" }).click();
  await page.getByRole("button", { name: /Team name: Ink Rats/ }).waitFor();
  log("renamed from header");

  // ------------------------------------------------------------------ other teams (API) join
  const others = [];
  for (let i = 1; i < 6; i++) {
    const ctx = await request.newContext({ baseURL: BASE });
    await api(ctx, "POST", "/api/join", { code: CODES[i] });
    await api(ctx, "POST", "/api/team/name", { name: ["Night Shift", "Ghost Lamp", "Clockwork", "Moss Hall", "Static"][i - 1] });
    others.push({ ctx, slot: i + 1 });
  }
  log("5 api teams joined");

  // ------------------------------------------------------------------ DESIGN
  await api(admin, "POST", "/api/admin/phase", { phase: "DESIGN", durationSec: 480 });
  await page.getByRole("heading", { name: "Build your level" }).waitFor({ timeout: 10000 });
  await shot(page, "design-empty");

  // other teams: generate (first one asks questions), answer, wait, submit - in the background
  const othersDone = (async () => {
    await Promise.all(
      others.map(async (t, i) => {
        const design = {
          genre: "Horror",
          feeling: ["uneasy", "hunted", "lonely", "frantic", "curious"][i],
          artStyle: "pixel art",
          level: `A sunken library with three reading rooms (team ${t.slot}).`,
          enemy: "A librarian made of moths who hears page turns.",
          ability: "A candle that makes the moths scatter.",
          puzzle: "Shelve three glowing books in the right order to open the exit.",
        };
        const g = await api(t.ctx, "POST", "/api/generate", { design, references: [], askQuestions: true });
        const id = g.generation.id;
        for (let k = 0; k < 60; k++) {
          const st = await api(t.ctx, "GET", "/api/state?view=team");
          const gen = st.generations.find((x) => x.id === id);
          if (gen.status === "questions") await api(t.ctx, "POST", `/api/generate/${id}/answers`, { answers: gen.questions.map(() => "dim green light") });
          if (gen.status === "done") break;
          if (["error", "refused", "flagged"].includes(gen.status)) throw new Error(`team ${t.slot} gen ${gen.status}`);
          await sleep(500);
        }
        await api(t.ctx, "POST", "/api/submit", { generationId: id });
      }),
    );
    log("api teams submitted");
  })();

  // validation: try to draw with an empty form
  await page.getByRole("button", { name: /Next: questions, then draw/ }).click();
  await page.getByText("Needed. A short line is fine.").first().waitFor();
  await shot(page, "design-missing");

  // fill the form
  await page.locator("label", { has: page.getByRole("radio", { name: "Horror" }) }).click();
  await page.getByRole("button", { name: "Insert example: hunted" }).click();
  await page.getByRole("button", { name: "Insert example: 1930s rubber-hose cartoon" }).click();
  const fill = async (label, text) => page.getByRole("textbox", { name: label, exact: true }).fill(text);
  await fill("Level", "An abandoned cartoon studio. Room 1: the ink-flooded lobby. Room 2: the animation desks. Room 3: the projector booth. The exit is the studio's back door.");
  await fill("Enemy", "A tall ink creature with a frozen grin that only moves when you are not looking at it. Dripping sounds warn you.");
  await fill("Ability", "A flickering film projector you carry that freezes the ink creature in its beam.");
  await fill("Puzzle", "Splice three film reels in the right order so the projector shows the code to the back door.");

  // reference images: small one on Enemy, big (>2048px) one on Level
  const enemyBlock = page.locator('[data-field="enemy"]');
  await enemyBlock.getByRole("button", { name: /Add a reference image/ }).click();
  const [fc1] = await Promise.all([page.waitForEvent("filechooser"), enemyBlock.getByRole("button", { name: /Add image/ }).click()]);
  await fc1.setFiles(REF_SMALL);
  if (REF_BIG) {
    const levelBlock = page.locator('[data-field="level"]');
    await levelBlock.getByRole("button", { name: /Add a reference image/ }).click();
    const [fc2] = await Promise.all([page.waitForEvent("filechooser"), levelBlock.getByRole("button", { name: /Add image/ }).click()]);
    await fc2.setFiles(REF_BIG);
  }
  await shot(page, "design-uploading", { both: false });
  // wait until uploads finished (no progress bars), up to 60s
  await page.waitForFunction(() => !document.querySelector('[aria-label="Uploading"]'), null, { timeout: 60000 });
  const dims = await page.evaluate(async () => {
    const imgs = [...document.querySelectorAll('[data-field] figure img')];
    return Promise.all(
      imgs.map(
        (im) =>
          new Promise((res) => {
            const i = new Image();
            i.onload = () => res({ src: i.src.split("/").pop(), w: i.naturalWidth, h: i.naturalHeight });
            i.onerror = () => res({ src: im.src, err: true });
            i.src = im.src;
          }),
      ),
    );
  });
  log("uploaded refs:", JSON.stringify(dims));
  await page.locator('[data-field="level"]').scrollIntoViewIfNeeded();
  await shot(page, "design-filled");
  await bigText(page, "design-large-text");

  // reload: the draft must survive
  await page.reload();
  await page.getByRole("heading", { name: "Build your level" }).waitFor();
  await page.getByRole("tab", { name: /Design/ }).click().catch(() => {});
  const levelAfter = await page.getByRole("textbox", { name: "Level", exact: true }).inputValue();
  if (!levelAfter.startsWith("An abandoned cartoon studio")) throw new Error("Draft did not survive reload");
  const refsAfter = await page.locator("[data-field] figure img").count();
  log("draft survived reload; refs:", refsAfter);

  // ------------------------------------------------------------------ generate #1 (questions)
  await page.getByRole("button", { name: /Next: questions, then draw/ }).click();
  await page.getByText("The artist is reading").waitFor();
  await shot(page, "asking");
  await page.getByRole("button", { name: "Draw it" }).waitFor({ timeout: 20000 });
  await shot(page, "questions", { full: false });
  const qInputs = page.locator('input[id^="qa-"]');
  const qn = await qInputs.count();
  await qInputs.nth(0).fill("Dim yellow work lights, wooden floors covered in ink puddles.");
  if (qn > 1) await page.getByRole("button", { name: "Skip" }).nth(1).click();
  await shot(page, "questions-answered", { both: false });
  await page.getByRole("button", { name: "Draw it" }).click();
  await page.getByText("Drawing your storyboard").first().waitFor();
  await sleep(1200);
  await shot(page, "generating");
  await page.getByRole("button", { name: "Submit this storyboard" }).waitFor({ timeout: 30000 });
  await shot(page, "result");
  await shot(page, "result-full", { full: true });

  // zoom
  await page.getByRole("button", { name: "Open storyboard full screen" }).first().click();
  await page.getByRole("button", { name: "Close" }).waitFor();
  await shot(page, "lightbox");
  await page.getByRole("button", { name: "Close" }).click();

  // artist was told
  await page.getByText("What the artist was told").click();
  await shot(page, "artist-told", { both: false, full: true });

  // submit
  await page.getByRole("button", { name: "Submit this storyboard" }).click();
  await page.getByText("This is your entry.").waitFor();
  await shot(page, "submitted");

  // ------------------------------------------------------------------ generate #2 (straight to drawing), resubmit
  await page.getByRole("tab", { name: /Design/ }).click();
  await fill("Enemy", "A tall ink creature with a frozen grin that only moves when you are not looking. MOCK_SOFTEN Dripping sounds warn you.");
  await page.getByRole("button", { name: "Redraw storyboard" }).click();
  await page.getByText("Drawing your storyboard").first().waitFor();
  await page.getByRole("button", { name: "Submit this one instead" }).waitFor({ timeout: 30000 });
  await shot(page, "result-v2-changes", { full: true });
  await page.getByRole("button", { name: "Submit this one instead" }).click();
  await page.getByText("This is your entry.").waitFor();
  await shot(page, "resubmitted");

  // ------------------------------------------------------------------ refused + flagged
  await page.getByRole("tab", { name: /Design/ }).click();
  await fill("Puzzle", "Splice three film reels in the right order. MOCK_REFUSE");
  await page.getByRole("button", { name: "Redraw storyboard" }).click();
  await page.getByText("The artist wouldn't draw this version").waitFor({ timeout: 30000 });
  await shot(page, "refused");
  await page.getByRole("button", { name: "Back to editing" }).click();
  await fill("Puzzle", "Splice three film reels in the right order. MOCK_FLAG");
  await page.getByRole("button", { name: "Redraw storyboard" }).click();
  await page.getByText("The safety filter stopped this one").waitFor({ timeout: 30000 });
  await shot(page, "flagged");
  await page.getByRole("button", { name: "Back to editing" }).click();
  await fill("Puzzle", "Splice three film reels in the right order so the projector shows the code to the back door.");

  // ask again -> questions -> cancel
  await page.getByLabel("Ask me questions again").check();
  await page.getByRole("button", { name: /Next: questions, then draw/ }).click();
  await page.getByRole("button", { name: "Draw it" }).waitFor({ timeout: 20000 });
  await page.getByRole("button", { name: "Never mind, back to editing" }).click();
  await page.getByRole("heading", { name: "Build your level" }).waitFor();
  log("ask-again + cancel ok");

  // history: reopen v1
  await page.getByRole("tab", { name: /Storyboard/ }).click();
  await page.getByRole("button", { name: /^Version 1/ }).click();
  await shot(page, "history-v1");

  // budget exhausted: shrink budget to what's spent
  const st1 = await api(admin, "GET", "/api/state?view=admin");
  const me = st1.teams.find((t) => t.slot === 1);
  await api(admin, "POST", "/api/dev/team-budget", { slot: 1, budgetUsd: Math.max(0.02, me.spendUsd + 0.01) });
  await page.getByRole("tab", { name: /Design/ }).click();
  await page.getByText(/Out of budget for new drawings/).waitFor({ timeout: 8000 });
  await shot(page, "out-of-budget");
  await api(admin, "POST", `/api/admin/team/1/reset-budget`);
  await api(admin, "POST", "/api/dev/team-budget", { slot: 1, budgetUsd: 5 });

  await othersDone;

  // ------------------------------------------------------------------ VOTING
  await api(admin, "POST", "/api/admin/phase", { phase: "VOTING", durationSec: 240 });
  await page.getByRole("heading", { name: /Rate \d designs/ }).waitFor({ timeout: 10000 });
  await shot(page, "voting");
  await bigText(page, "voting-large-text");
  await shot(page, "voting-full", { both: false, full: true });
  const total = await page.locator('[aria-label="Designs to rate"] li').count();
  for (let i = 0; i < total; i++) {
    for (const [k, v] of [["Level", 4], ["Enemy", 3], ["Ability", 5], ["Puzzle", 4]]) {
      await page.getByRole("group", { name: new RegExp(`^${k}`) }).locator("label", { has: page.getByRole("radio", { name: new RegExp(`^${v},`) }) }).click();
    }
    await page.getByText("Saved", { exact: true }).waitFor({ timeout: 8000 });
    if (i === 0) await shot(page, "voting-rated-1");
    if (i < total - 1) await page.getByRole("button", { name: "Next design" }).click();
  }
  await page.getByText("All rated.").waitFor();
  await shot(page, "voting-all-done");

  // other teams vote: give team 1's design 5s (they can't see authors; give everything 5 except randomness)
  for (const t of others) {
    const st = await api(t.ctx, "GET", "/api/state?view=team");
    for (const a of st.voting.assigned) {
      const isInk = a.inputs.level.startsWith("An abandoned cartoon studio");
      const sc = isInk ? { level: 5, enemy: 5, ability: 5, puzzle: 5 } : { level: 2 + (t.slot % 3), enemy: 3, ability: 2, puzzle: 3 };
      await api(t.ctx, "POST", "/api/vote", { target: a.target, scores: sc });
    }
  }
  log("api teams voted");

  // ------------------------------------------------------------------ REVEAL
  await api(admin, "POST", "/api/admin/phase", { phase: "REVEAL" });
  await page.getByText("big screen", { exact: true }).waitFor({ timeout: 10000 });
  await shot(page, "reveal-lookup");
  await api(admin, "POST", "/api/admin/reveal", { action: "next" });
  await sleep(2600);
  await shot(page, "reveal-step1");
  await api(admin, "POST", "/api/admin/reveal", { action: "next" });
  await api(admin, "POST", "/api/admin/reveal", { action: "next" });
  await page.getByText("You won!").waitFor({ timeout: 10000 });
  await sleep(1500);
  await shot(page, "reveal-winner");

  // ------------------------------------------------------------------ CLOSED
  await api(admin, "POST", "/api/admin/phase", { phase: "CLOSED" });
  await page.getByText("That's a wrap").waitFor({ timeout: 10000 });
  await shot(page, "closed");
  await shot(page, "closed-full", { both: false, full: true });

  // ------------------------------------------------------------------ session expiry
  await api(admin, "POST", "/api/admin/reset-event", { confirm: "RESET" });
  await page.getByText(/event was reset|session ended/).waitFor({ timeout: 10000 });
  await shot(page, "session-expired");

  // ------------------------------------------------------------------ reconnecting indicator
  await context.setOffline(true);
  await page.getByText("Reconnecting").waitFor({ timeout: 15000 });
  await shot(page, "reconnecting", { both: false });
  await context.setOffline(false);
  await page.getByText("Reconnecting").waitFor({ state: "hidden", timeout: 20000 });
  log("reconnect ok");

  await browser.close();
  if (errors.length) {
    console.log("BROWSER ERRORS:\n" + [...new Set(errors)].join("\n"));
  }
  log("DONE", n, "shots in", SHOTS);
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
