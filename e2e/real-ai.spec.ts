// ONE real end-to-end run with real OpenAI calls and a real Vercel Blob upload. Costs about $0.15.
// Skipped unless E2E_REAL_AI=1 (playwright.config.ts then starts the server without MOCK_AI):
//
//   E2E_REAL_AI=1 npx playwright test e2e/real-ai.spec.ts
//
// One team goes through the UI: reference upload, follow-up questions, storyboard, one redraw.
// Prints latencies and costs, checks that budget accounting equals the summed generation costs,
// saves the images to test-results/real/, then resets the dev event (which deletes its blobs).
import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const REAL = process.env.E2E_REAL_AI === "1";
const CODES = (process.env.TEAM_CODES || "").split(",").map((s) => s.trim()).filter(Boolean);
const ADMIN = process.env.ADMIN_CODE || "";
const REF = process.env.REF_IMAGE || path.resolve(__dirname, "../../deck/assets/corridor.jpg");
const OUT = path.resolve(__dirname, "../test-results/real");
const CAP_USD = 3;

test.skip(!REAL, "real-AI run only with E2E_REAL_AI=1");
test.setTimeout(10 * 60_000);

const field = (p: Page, label: string) => p.getByRole("textbox", { name: label, exact: true });

test("real AI: one team, reference upload, questions, storyboard, redraw", async ({ browser }) => {
  fs.mkdirSync(OUT, { recursive: true });
  const adminCtx = await browser.newContext();
  const admin = adminCtx.request;
  expect((await admin.post("/api/admin/login", { data: { code: ADMIN } })).ok()).toBeTruthy();
  expect((await admin.post("/api/admin/reset-event", { data: { confirm: "RESET" } })).ok()).toBeTruthy();
  expect((await admin.post("/api/admin/phase", { data: { phase: "DESIGN", durationSec: 900 } })).ok()).toBeTruthy();

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const p = await ctx.newPage();
  await p.goto("/");
  await p.getByLabel("Your team code").fill(CODES[0]);
  await p.getByRole("button", { name: "Join" }).click();
  await p.getByLabel("Pick a team name").fill("QA Real Run");
  await p.getByRole("button", { name: "Let's go" }).click();
  await expect(p.getByRole("heading", { name: "Build your level" })).toBeVisible();

  await p.locator("label", { has: p.getByRole("radio", { name: "Sci-fi" }) }).click();
  await field(p, "Feeling").fill("hunted, claustrophobic");
  await field(p, "Art style").fill("gritty 1970s sci-fi film still, grainy");
  await field(p, "Level").fill(
    "A derelict cargo ship. Start room: a padded white airlock. Room 1: a long padded corridor with flickering lights. Room 2: the flooded cargo bay full of yellow crates. Room 3: the reactor control room. The exit is the escape shuttle bay.",
  );
  await field(p, "Enemy").fill("A tall, thin machine that crawls through the air vents and hunts by sound. A clicking noise warns you it is close.");
  await field(p, "Ability").fill("A motion tracker found in room 1 that beeps faster when the machine is near, so you can time your movement.");
  await field(p, "Puzzle").fill("Restore power by connecting three color-coded cables in the reactor room; the shuttle bay door opens when all three are lit.");

  // Real Vercel Blob client upload on the Level field.
  const level = p.locator('[data-field="level"]');
  await level.getByRole("button", { name: /Add a reference image/ }).click();
  const [fc] = await Promise.all([p.waitForEvent("filechooser"), level.getByRole("button", { name: /Add image/ }).click()]);
  await fc.setFiles(REF);
  await expect(level.locator("figure img")).toBeVisible({ timeout: 60_000 });
  await p.waitForFunction(() => !document.querySelector('[aria-label="Uploading"]'), null, { timeout: 60_000 });
  const refUrl = await level.locator("figure img").getAttribute("src");
  expect(refUrl).toMatch(/^https:\/\/[a-z0-9]+\.public\.blob\.vercel-storage\.com\/dev-dyl_dev_/);

  const timings: Record<string, number> = {};
  let t0 = Date.now();
  await p.getByRole("button", { name: /Next: questions, then draw/ }).click();
  await expect(p.getByRole("button", { name: "Draw it" })).toBeVisible({ timeout: 120_000 });
  timings.questionsS = (Date.now() - t0) / 1000;
  const qs = p.locator('input[id^="qa-"]');
  const nq = await qs.count();
  const questions: string[] = [];
  for (let i = 0; i < nq; i++) questions.push((await p.locator(`label[for="${await qs.nth(i).getAttribute("id")}"]`).innerText().catch(() => "?")).trim());
  const answers = [
    "Cold blue emergency lights, wet metal floors, steam from broken pipes.",
    "It is matte black with long jointed legs and a single red sensor light.",
    "It slows the machine down for a few seconds when it is close.",
  ];
  for (let i = 0; i < nq; i++) await qs.nth(i).fill(answers[i] ?? "Keep it simple.");
  t0 = Date.now();
  await p.getByRole("button", { name: "Draw it" }).click();
  const outcome1 = await Promise.race([
    p.getByRole("button", { name: "Submit this storyboard" }).waitFor({ timeout: 240_000 }).then(() => "done"),
    p.getByRole("heading", { name: /wouldn't draw|safety filter|went wrong/ }).waitFor({ timeout: 240_000 }).then(() => "failed"),
  ]);
  timings.firstStoryboardS = (Date.now() - t0) / 1000;
  await p.screenshot({ path: path.join(OUT, "result-1.png"), fullPage: true });
  expect(outcome1).toBe("done");
  await p.getByRole("button", { name: "Submit this storyboard" }).click();
  await expect(p.getByText("This is your entry.")).toBeVisible();

  // Spend guard before the second call.
  let st = await (await p.request.get("/api/state?view=team")).json();
  expect(st.team.spendUsd).toBeLessThan(CAP_USD);

  // One redraw (no questions).
  await field(p, "Enemy").fill(
    "A tall, thin machine that crawls through the air vents and hunts by sound. It has a single red sensor light. A clicking noise warns you it is close.",
  );
  t0 = Date.now();
  await p.getByRole("button", { name: "Redraw storyboard" }).click();
  const outcome2 = await Promise.race([
    p.getByRole("button", { name: "Submit this one instead" }).waitFor({ timeout: 240_000 }).then(() => "done"),
    p.getByRole("heading", { name: /wouldn't draw|safety filter|went wrong/ }).waitFor({ timeout: 240_000 }).then(() => "failed"),
  ]);
  timings.redrawS = (Date.now() - t0) / 1000;
  await p.screenshot({ path: path.join(OUT, "result-2.png"), fullPage: true });

  st = await (await p.request.get("/api/state?view=team")).json();
  const gens = st.generations as Array<{ id: string; status: string; costUsd: number; msText: number | null; msImage: number | null; imageUrl: string | null; questions: string[] | null; changesMade: string[] | null; imagePrompt: string | null; referenceRoles: string[] | null }>;
  const sum = Math.round(gens.reduce((a, g) => a + g.costUsd, 0) * 1e4) / 1e4;
  const report = {
    timings,
    questions,
    generations: gens.map((g) => ({ status: g.status, costUsd: g.costUsd, msText: g.msText, msImage: g.msImage, changesMade: g.changesMade, referenceRoles: g.referenceRoles, promptChars: g.imagePrompt?.length })),
    team: st.team,
    summedGenerationCostUsd: sum,
  };
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(OUT, "prompt-1.txt"), gens[gens.length - 1]?.imagePrompt ?? "");
  for (const [i, g] of [...gens].reverse().entries()) {
    if (!g.imageUrl) continue;
    const r = await p.request.get(g.imageUrl);
    fs.writeFileSync(path.join(OUT, `storyboard-${i + 1}.jpg`), await r.body());
  }
  console.log("REAL RUN REPORT", JSON.stringify(report, null, 2));

  expect(outcome2).toBe("done");
  expect(Math.abs(st.team.spendUsd - sum)).toBeLessThan(1e-3);
  expect(st.team.reservedUsd).toBe(0);
  expect(st.team.spendUsd).toBeLessThan(CAP_USD);

  // Clean up: reset the dev event (deletes this dev namespace's blobs).
  const reset = await (await admin.post("/api/admin/reset-event", { data: { confirm: "RESET" } })).json();
  console.log("new game started; saved game", reset.previousGame);
  expect(reset.ok).toBeTruthy();
  await ctx.close();
  await adminCtx.close();
});
