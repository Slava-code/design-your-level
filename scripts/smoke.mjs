#!/usr/bin/env node
// End-to-end smoke test of the HTTP API. Starts nothing: point it at a running server that has
// MOCK_AI=1 and a DEV database (never production):
//
//   MOCK_AI=1 MOCK_AI_DELAY_MS=300 DEV_DB_NAME=dyl_dev_backend NEXT_DIST_DIR=.next-backend npx next dev -p 3201
//   BASE_URL=http://localhost:3201 node scripts/smoke.mjs
//
// WARNING: it runs Reset event on that server (wipes its database). Team/admin codes are read from
// .env.local and never printed. Exits non-zero on the first failure.
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envFile = path.join(root, ".env.local");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const BASE = (process.env.BASE_URL || "http://localhost:3201").replace(/\/$/, "");
if (/play\.mottonote\.app/.test(BASE) && process.env.SMOKE_ALLOW_PROD !== "1") {
  console.error("smoke: refusing to run against production (it resets the event). Set SMOKE_ALLOW_PROD=1 to override.");
  process.exit(2);
}
const CODES = (process.env.TEAM_CODES || "").split(",").map((s) => s.trim()).filter(Boolean);
const ADMIN = process.env.ADMIN_CODE || "";
if (CODES.length < 8 || !ADMIN) {
  console.error("smoke: need TEAM_CODES (>= 8) and ADMIN_CODE in the environment or .env.local");
  process.exit(2);
}

// ------------------------------------------------------------------------------------------------
let step = 0;
const t0 = Date.now();
function ok(msg) {
  step++;
  console.log(`  ok ${String(step).padStart(2)}  ${msg}`);
}
function fail(msg, extra) {
  console.error(`\nFAIL: ${msg}`);
  if (extra !== undefined) console.error(typeof extra === "string" ? extra : JSON.stringify(extra, null, 2).slice(0, 2000));
  process.exit(1);
}
function expect(cond, msg, extra) {
  if (!cond) fail(msg, extra);
  ok(msg);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Client {
  constructor(name) {
    this.name = name;
    this.jar = new Map();
  }
  async req(method, p, body) {
    const headers = { accept: "application/json" };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (this.jar.size) headers.cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
    const res = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [kv, ...attrs] = c.split(";");
      const i = kv.indexOf("=");
      const k = kv.slice(0, i).trim();
      const v = kv.slice(i + 1).trim();
      const expired = attrs.some((a) => /max-age=0/i.test(a.trim()) || /expires=Thu, 01 Jan 1970/i.test(a.trim()));
      if (!v || expired) this.jar.delete(k);
      else this.jar.set(k, v);
    }
    let json = null;
    const text = await res.text();
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text.slice(0, 300) };
    }
    return { status: res.status, json, headers: res.headers };
  }
  get(p) {
    return this.req("GET", p);
  }
  post(p, body = {}) {
    return this.req("POST", p, body);
  }
  async state(view = "team", since) {
    const r = await this.get(`/api/state?view=${view}${since != null ? `&since=${since}` : ""}`);
    if (r.status !== 200) fail(`${this.name}: GET /api/state -> ${r.status}`, r.json);
    return r.json;
  }
}

const design = (extra = {}) => ({
  genre: "horror",
  feeling: "hunted",
  artStyle: "1930s rubber-hose cartoon",
  level: "An abandoned cartoon studio: lobby, ink room, projection booth.",
  enemy: "A smiling ink mascot that follows the sound of footsteps.",
  ability: "A flashlight that freezes ink in place.",
  puzzle: "Rewind the film reel to open the exit door.",
  ...extra,
});

async function waitFor(client, genId, statuses, timeoutMs = 30000) {
  const end = Date.now() + timeoutMs;
  let last;
  while (Date.now() < end) {
    const s = await client.state("team");
    last = s.generations?.find((g) => g.id === genId);
    if (last && statuses.includes(last.status)) return { gen: last, state: s };
    await sleep(250);
  }
  fail(`${client.name}: generation ${genId} did not reach ${statuses.join("|")} (last: ${last?.status})`, last);
}

const variant = (code) => "  " + code.toUpperCase().replace(/-/g, " ") + " "; // normalisation check

// ------------------------------------------------------------------------------------------------
async function main() {
  console.log(`smoke: ${BASE}`);
  const ping = await fetch(BASE + "/api/state").catch((e) => fail(`server not reachable at ${BASE}: ${e.message}`));
  expect(ping.status === 200, "server reachable, GET /api/state is 200 without a session");

  // Admin login + reset
  const admin = new Client("admin");
  let r = await admin.post("/api/admin/login", { code: "definitely-not-the-admin-code" });
  expect(r.status === 401 && r.json.code === "invalid_code", "wrong admin code is rejected (401 invalid_code)");
  r = await admin.post("/api/admin/reset-event", { confirm: "RESET" });
  expect(r.status === 401 && r.json.code === "unauthorized", "reset-event without admin session is 401");
  r = await admin.post("/api/admin/login", { code: ADMIN });
  expect(r.status === 200 && admin.jar.has("dyl_admin"), "admin login sets dyl_admin cookie");
  r = await admin.post("/api/admin/reset-event", { confirm: "nope" });
  expect(r.status === 400, "reset-event needs typed RESET");
  r = await admin.post("/api/admin/reset-event", { confirm: "RESET" });
  expect(r.status === 200 && r.json.ok && Number.isInteger(r.json.epoch), `new game started (epoch ${r.json.epoch})`);
  const epoch1 = r.json.epoch;
  let as = await admin.state("admin");
  expect(as.role === "admin" && as.teams.length === 0 && as.phase === "LOBBY" && as.epoch === epoch1, "admin state empty after reset, phase LOBBY");
  expect(as.slotsConfigured === CODES.length, "slotsConfigured matches TEAM_CODES length");
  const screen0 = await admin.state("screen");
  expect(screen0.role === "screen", "screen view works with admin cookie");
  const anonScreen = await new Client("anon").state("screen");
  expect(anonScreen.role === "anon", "screen view without admin cookie is anon");
  const bodyText = JSON.stringify(as) + JSON.stringify(screen0);
  expect(!CODES.some((c) => bodyText.includes(c)) && !bodyText.includes(ADMIN), "no codes appear in admin/screen state");

  // Joins
  const A = new Client("A"), A2 = new Client("A2"), B = new Client("B");
  r = await A.post("/api/join", { code: variant(CODES[0]) });
  expect(r.status === 200 && r.json.team.slot === 1 && r.json.team.name === "Team 1" && r.json.firstJoin, "team A joins (code normalised) as Team 1");
  expect(!JSON.stringify(r.json).includes(CODES[0]), "join response contains no code");
  r = await A2.post("/api/join", { code: CODES[0] });
  expect(r.status === 200 && r.json.team.slot === 1 && !r.json.firstJoin, "second device with same code joins the same team");
  r = await B.post("/api/join", { code: CODES[1] });
  expect(r.status === 200 && r.json.team.slot === 2, "team B joins as Team 2");
  const X = new Client("X");
  r = await X.post("/api/join", { code: "wrong-code-here" });
  expect(r.status === 401 && r.json.code === "invalid_code", "wrong team code rejected");
  r = await X.post("/api/join", {});
  expect(r.status === 400 && r.json.code === "bad_request", "join without code is 400");
  r = await X.post("/api/generate", { design: design(), references: [], askQuestions: true });
  expect(r.status === 401, "generate without session is 401");

  // Rename
  r = await A.post("/api/team/name", { name: "   The   Night\tShift  " });
  expect(r.status === 200 && r.json.team.name === "The Night Shift", "rename trims and collapses whitespace");
  r = await A.post("/api/team/name", { name: "x".repeat(33) });
  expect(r.status === 400, "rename over 32 chars rejected");
  let sA = await A2.state("team");
  expect(sA.role === "team" && sA.team.name === "The Night Shift" && sA.canRename, "other device sees the new name");
  expect(sA.nextGenerateAsksQuestions === true && typeof sA.uploadPrefix === "string" && sA.uploadPrefix.includes(`ev${epoch1}/refs/slot1/`), "team state has uploadPrefix and first-generation flag");

  // Draft autosave: one server copy per team, shared by its devices; foreign image links dropped.
  r = await A.get("/api/team/draft");
  expect(r.status === 200 && r.json.draft === null, "no draft before typing");
  r = await A.post("/api/team/draft", {
    fields: { feeling: "lonely, uneasy ", level: "x".repeat(5000), evil: "nope" },
    refs: [
      { id: "r1", field: "level", url: `https://example.com/${sA.uploadPrefix}a.png` },
      { id: "r2", field: "nope", url: "https://x.public.blob.vercel-storage.com/a.png" },
    ],
  });
  expect(r.status === 200 && r.json.updatedAt, "draft saved");
  r = await A2.get("/api/team/draft");
  const dr = r.json.draft;
  expect(
    dr && dr.fields.feeling === "lonely, uneasy " && dr.fields.level.length < 5000 && dr.fields.genre === "" && !("evil" in dr.fields) && dr.refs.length === 0,
    "other device reads the draft: kept as typed, capped, unknown keys and foreign refs dropped",
  );
  r = await B.get("/api/team/draft");
  expect(r.status === 200 && r.json.draft === null, "another team can't see the draft");
  r = await X.get("/api/team/draft");
  expect(r.status === 401, "draft without session is 401");

  // Phase rules
  r = await A.post("/api/generate", { design: design(), references: [], askQuestions: false });
  expect(r.status === 409 && r.json.code === "phase", "generate in LOBBY is rejected (phase)");
  r = await admin.post("/api/admin/phase", { phase: "VOTING" });
  expect(r.status === 409 && r.json.code === "phase", "admin can't skip LOBBY -> VOTING");
  r = await A.post("/api/admin/phase", { phase: "DESIGN" });
  expect(r.status === 401, "team cookie can't call admin routes");
  r = await admin.post("/api/admin/phase", { phase: "DESIGN", durationSec: 480 });
  expect(r.status === 200 && r.json.phase === "DESIGN" && r.json.phaseEndsAt, "phase -> DESIGN with 8 min timer");
  sA = await A.state("team");
  const remaining = Date.parse(sA.phaseEndsAt) - Date.parse(sA.serverNow);
  expect(remaining > 470000 && remaining <= 480000, `timer end time consistent with serverNow (${Math.round(remaining / 1000)}s)`);
  r = await admin.post("/api/admin/timer", { addSec: 60 });
  expect(r.status === 200 && Date.parse(r.json.phaseEndsAt) - Date.parse(sA.phaseEndsAt) >= 59000, "timer +60s");

  // Validation
  r = await A.post("/api/generate", { design: { genre: "", feeling: "", artStyle: "", level: "", enemy: "", ability: "", puzzle: "" }, references: [], askQuestions: true });
  expect(r.status === 400, "empty design rejected");
  r = await A.post("/api/generate", { design: design({ level: "x".repeat(1501) }), references: [], askQuestions: true });
  expect(r.status === 400, "over-long field rejected");
  r = await A.post("/api/generate", { design: design(), references: [{ url: "https://evil.example.com/a.png", field: "level" }], askQuestions: true });
  expect(r.status === 400, "foreign reference URL rejected");

  // First generation always asks questions
  r = await A.post("/api/generate", { design: design(), references: [], askQuestions: false });
  expect(r.status === 200 && r.json.generation.status === "asking" && r.json.generation.askedQuestions, "first generation asks questions even when askQuestions=false");
  const g1 = r.json.generation.id;
  r = await A2.post("/api/generate", { design: design(), references: [], askQuestions: false });
  expect(r.status === 409 && r.json.code === "busy", "second generate while one is in flight is busy");
  let w = await waitFor(A, g1, ["questions", "error"]);
  expect(w.gen.status === "questions" && w.gen.questions.length >= 1 && w.gen.questions.length <= 3, `follow-up questions arrive (${w.gen.questions?.length})`);
  r = await A.post("/api/generate", { design: design(), references: [], askQuestions: false });
  expect(r.status === 409 && r.json.code === "busy", "generate while questions are pending is busy");
  r = await A.post(`/api/generate/${g1}/answers`, { answers: ["A dusty lobby lit by one bulb", "", "Behind the projector"] });
  expect(r.status === 200 && r.json.generation.status === "generating", "answers (one skipped) start generating");
  r = await A.post(`/api/generate/${g1}/answers`, { answers: ["again"] });
  expect(r.status === 409 && r.json.code === "conflict", "answering twice is a conflict");
  w = await waitFor(A, g1, ["done", "error", "refused"]);
  expect(w.gen.status === "done" && w.gen.imageUrl && w.gen.panelCaptions?.length === 4 && w.gen.imagePrompt, "generation 1 done with image, 4 captions and prompt");
  expect(Array.isArray(w.gen.answers) && w.gen.answers[1] === "", "skipped answer stored as empty string");
  const img = await fetch(w.gen.imageUrl);
  expect(img.status === 200 && /image\//.test(img.headers.get("content-type") || ""), `storyboard image is publicly fetchable (${img.headers.get("content-type")})`);
  expect(w.state.team.reservedUsd === 0, "reservation released after done");

  // Regenerate without questions
  r = await A.post("/api/generate", { design: design({ feeling: "lonely" }), references: [], askQuestions: false });
  expect(r.status === 200 && r.json.generation.status === "generating" && !r.json.generation.askedQuestions, "regenerate skips questions");
  const g2 = r.json.generation.id;
  w = await waitFor(A, g2, ["done", "error", "refused"]);
  expect(w.gen.status === "done" && w.gen.questions === null, "generation 2 done (no follow-up round)");

  // Ask again on request
  r = await A.post("/api/generate", { design: design(), references: [], askQuestions: true });
  expect(r.status === 200 && r.json.generation.status === "asking", "askQuestions=true asks again");
  const g3 = r.json.generation.id;
  await waitFor(A, g3, ["questions"]);
  r = await A.post(`/api/generate/${g3}/cancel`);
  expect(r.status === 200 && r.json.generation.status === "error", "pending questions can be cancelled");

  // Refusal is charged
  const spendBefore = (await A.state()).team.spendUsd;
  r = await A.post("/api/generate", { design: design({ level: "MOCK_REFUSE a very bad room" }), references: [], askQuestions: false });
  const g4 = r.json.generation?.id;
  w = await waitFor(A, g4, ["done", "error", "refused"]);
  expect(w.gen.status === "refused" && w.gen.error && w.gen.costUsd > 0, `refusal recorded with friendly message and cost $${w.gen.costUsd}`);
  expect(Math.abs(w.state.team.spendUsd - spendBefore - w.gen.costUsd) < 1e-6 && w.state.team.reservedUsd === 0, "refusal charged to team spend; reservation released");

  // Moderation flag is free
  r = await A.post("/api/generate", { design: design({ enemy: "MOCK_FLAG something" }), references: [], askQuestions: false });
  expect(r.status === 200 && r.json.generation.status === "flagged" && r.json.generation.costUsd === 0 && r.json.generation.error, "moderation-flagged design: status flagged, no charge");

  // Zero questions -> straight to generating (team B's first generation)
  r = await B.post("/api/generate", { design: design({ level: "MOCK_CLEAR three rooms of a sunken ship" }), references: [], askQuestions: false });
  expect(r.status === 200 && r.json.generation.status === "asking", "team B first generation asks");
  const b1 = r.json.generation.id;
  w = await waitFor(B, b1, ["done", "error", "refused"]);
  expect(w.gen.status === "done" && Array.isArray(w.gen.questions) && w.gen.questions.length === 0, "no questions -> went straight on to the image");

  // Budget exhaustion
  r = await admin.post("/api/dev/team-budget", { slot: 2, budgetUsd: 0.1 });
  expect(r.status === 200, "dev route lowers team B budget");
  r = await B.post("/api/generate", { design: design(), references: [], askQuestions: false });
  expect(r.status === 402 && r.json.code === "budget", "generate over budget is refused (402 budget)");
  let sB = await B.state();
  expect(sB.generations.length === 1 && sB.team.reservedUsd === 0, "no generation created and nothing reserved when over budget");
  r = await admin.post("/api/dev/team-budget", { slot: 2, budgetUsd: 5 });
  expect(r.status === 200, "budget restored");

  // Reference upload token route
  r = await B.post("/api/upload", { type: "blob.generate-client-token", payload: { pathname: "ev999/refs/slot1/x.png", clientPayload: null, multipart: false } });
  expect(r.status === 400, "upload token refused for another team's prefix");
  r = await X.post("/api/upload", { type: "blob.generate-client-token", payload: { pathname: `ev${epoch1}/refs/slot2/x.png`, clientPayload: null, multipart: false } });
  expect(r.status === 401, "upload token needs a team session");
  sB = await B.state();
  r = await B.post("/api/upload", { type: "blob.generate-client-token", payload: { pathname: `${sB.uploadPrefix}ref.png`, clientPayload: null, multipart: false } });
  expect(r.status === 200 && typeof r.json.clientToken === "string", "upload token issued for own prefix");
  let refUrl = null;
  try {
    const { upload } = await import("@vercel/blob/client");
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
    const blob = await upload(`${sB.uploadPrefix}ref.png`, new Blob([png], { type: "image/png" }), {
      access: "public",
      handleUploadUrl: BASE + "/api/upload",
      headers: { cookie: [...B.jar].map(([k, v]) => `${k}=${v}`).join("; ") },
      contentType: "image/png",
    });
    refUrl = blob.url;
  } catch (e) {
    fail(`client upload through /api/upload failed: ${e.message}`);
  }
  expect(refUrl && new URL(refUrl).pathname.startsWith("/" + sB.uploadPrefix), "reference image uploaded via client upload under the team prefix");
  r = await B.post("/api/generate", { design: design(), references: [{ url: refUrl, field: "artStyle" }], askQuestions: false });
  expect(r.status === 200 && r.json.generation.references.length === 1, "generate accepts own uploaded reference");
  const b2 = r.json.generation.id;
  w = await waitFor(B, b2, ["done", "error", "refused"]);
  expect(w.gen.status === "done" && w.gen.referenceRoles?.length === 1, "generation with reference done");
  r = await A.post("/api/generate", { design: design(), references: [{ url: refUrl, field: "artStyle" }], askQuestions: false });
  expect(r.status === 400, "team A can't use team B's reference URL");

  // Submit / resubmit
  r = await A.post("/api/submit", { generationId: g4 });
  expect(r.status === 409, "refused generation can't be submitted");
  r = await A.post("/api/submit", { generationId: b1 });
  expect(r.status === 404, "another team's generation can't be submitted");
  r = await A.post("/api/submit", { generationId: g1 });
  expect(r.status === 200 && r.json.team.submittedGenerationId === g1, "team A submits generation 1");
  r = await A.post("/api/submit", { generationId: g2 });
  expect(r.status === 200 && r.json.team.submittedGenerationId === g2, "team A resubmits generation 2");
  sA = await A.state();
  expect(sA.generations.find((g) => g.id === g2).submitted && !sA.generations.find((g) => g.id === g1).submitted, "submitted flag follows the resubmission");
  r = await B.post("/api/submit", { generationId: b2 });
  expect(r.status === 200, "team B submits");

  // More teams: 3..6 submit, 7 doesn't
  const others = [];
  for (let i = 2; i < 7; i++) {
    const c = new Client(`T${i + 1}`);
    r = await c.post("/api/join", { code: CODES[i] });
    if (r.status !== 200) fail(`team ${i + 1} join failed`, r.json);
    others.push(c);
  }
  ok("teams 3-7 joined");
  const pending = [];
  for (const c of others.slice(0, 4)) {
    r = await c.post("/api/generate", { design: design({ level: `MOCK_CLEAR level by ${c.name}` }), references: [], askQuestions: false });
    if (r.status !== 200) fail(`${c.name} generate failed`, r.json);
    pending.push([c, r.json.generation.id]);
  }
  for (const [c, id] of pending) {
    const x = await waitFor(c, id, ["done", "error", "refused"]);
    if (x.gen.status !== "done") fail(`${c.name} generation not done`, x.gen);
    r = await c.post("/api/submit", { generationId: id });
    if (r.status !== 200) fail(`${c.name} submit failed`, r.json);
  }
  ok("teams 3-6 generated (in parallel) and submitted; team 7 did not");

  as = await admin.state("admin");
  expect(as.teams.length === 7 && as.totals.submissions === 6, "admin sees 7 teams, 6 submissions");
  const t1 = as.teams.find((t) => t.slot === 1);
  expect(t1.name === "The Night Shift" && t1.activity === "submitted" && t1.submittedImageUrl && t1.generationCount >= 4, "admin row: name, activity, thumbnail, generation count");
  expect(as.totals.totalSpendUsd > 0 && as.feed.length > 0 && as.feedCursor === as.feed[as.feed.length - 1].id, `admin totals and feed (total spend $${as.totals.totalSpendUsd})`);
  const types = new Set(as.feed.map((f) => f.type));
  expect(["joined", "renamed", "asked", "generated", "refused", "flagged", "submitted", "phase"].every((t) => types.has(t)), "feed has joined/renamed/asked/generated/refused/flagged/submitted/phase");
  const since = as.feedCursor;
  let as2 = await admin.state("admin", since);
  expect(as2.feed.length === 0 && as2.feedCursor === since, "feed ?since returns only newer items");
  r = await admin.get("/api/admin/team/1");
  expect(r.status === 200 && r.json.generations.length >= 5 && "errorDetail" in r.json.generations[0], "admin team detail lists all generations with detail");

  // VOTING
  r = await admin.post("/api/admin/phase", { phase: "VOTING", durationSec: 240 });
  expect(r.status === 200 && r.json.phase === "VOTING", "phase -> VOTING");
  r = await A.post("/api/team/name", { name: "The Night Shift" });
  expect(r.status === 200 && r.json.team.name === "The Night Shift", "rename still allowed during VOTING");
  r = await B.post("/api/submit", { generationId: b1 });
  expect(r.status === 409, "submit locked during VOTING");
  r = await A.post("/api/generate", { design: design(), references: [], askQuestions: false });
  expect(r.status === 409, "generate locked during VOTING");

  const teams = [A, B, ...others];
  const subGen = {}; // slot -> submitted generation id
  as = await admin.state("admin");
  for (const t of as.teams) subGen[t.slot] = t.submittedGenerationId;
  const counts = {};
  const assignedBy = {};
  for (let i = 0; i < teams.length; i++) {
    const s = await teams[i].state();
    const slot = s.team.slot;
    const list = s.voting?.assigned ?? [];
    assignedBy[slot] = list;
    for (const d of list) {
      if (d.target === subGen[slot]) fail(`team ${slot} was assigned its own design`);
      if ("slot" in d || "name" in d || "teamName" in d) fail("assigned design leaks author identity", d);
      counts[d.target] = (counts[d.target] || 0) + 1;
    }
    if (list.length !== 4) fail(`team ${slot} should rate 4 designs, got ${list.length}`);
    if (new Set(list.map((d) => d.target)).size !== list.length) fail(`team ${slot} got duplicate targets`);
  }
  const cv = Object.values(counts);
  expect(cv.length === 6 && Math.max(...cv) - Math.min(...cv) <= 1, `assignments: every team rates 4, none its own, ratings per design balanced (${cv.join(",")})`);

  // Go back to DESIGN, team 7 submits, VOTING again -> with 7 submitters each design gets exactly 4
  r = await admin.post("/api/admin/phase", { phase: "DESIGN", durationSec: 60 });
  expect(r.status === 200 && r.json.phase === "DESIGN", "admin can step back VOTING -> DESIGN");
  const T7 = others[4];
  r = await T7.post("/api/generate", { design: design({ level: "MOCK_CLEAR late entry" }), references: [], askQuestions: false });
  w = await waitFor(T7, r.json.generation.id, ["done"]);
  r = await T7.post("/api/submit", { generationId: w.gen.id });
  expect(r.status === 200, "team 7 submits late");
  r = await admin.post("/api/admin/phase", { phase: "VOTING", durationSec: 240 });
  expect(r.status === 200, "phase -> VOTING again");
  as = await admin.state("admin");
  for (const t of as.teams) subGen[t.slot] = t.submittedGenerationId;
  const counts2 = {};
  for (const tm of teams) {
    const s = await tm.state();
    assignedBy[s.team.slot] = s.voting.assigned;
    for (const d of s.voting.assigned) {
      if (d.target === subGen[s.team.slot]) fail("own design assigned");
      counts2[d.target] = (counts2[d.target] || 0) + 1;
    }
  }
  expect(Object.values(counts2).length === 7 && Object.values(counts2).every((n) => n === 4), "7 submitters: each design gets exactly 4 ratings");

  // Votes: score design of slot k with level=enemy=ability=puzzle=k (capped at 5) -> slot 5..7 tie on 5,
  // and we break it by giving slot 7 sixes... (capped) so instead: everyone gives slot 3 all 5s, others 2s.
  const slotOfGen = Object.fromEntries(Object.entries(subGen).map(([s, g]) => [g, Number(s)]));
  const scoreFor = (targetSlot) => (targetSlot === 3 ? 5 : targetSlot === 5 ? 4 : targetSlot === 1 ? 3 : 2);
  r = await A.post("/api/vote", { target: subGen[1], scores: { level: 5, enemy: 5, ability: 5, puzzle: 5 } });
  expect(r.status === 400, "voting for own / unassigned design rejected");
  r = await A.post("/api/vote", { target: assignedBy[1][0].target, scores: { level: 6, enemy: 1, ability: 1, puzzle: 1 } });
  expect(r.status === 400, "score out of range rejected");
  for (const tm of teams) {
    const s = await tm.state();
    for (const d of s.voting.assigned) {
      const v = scoreFor(slotOfGen[d.target]);
      const vr = await tm.post("/api/vote", { target: d.target, scores: { level: v, enemy: v, ability: v, puzzle: v } });
      if (vr.status !== 200) fail(`${tm.name} vote failed`, vr.json);
    }
  }
  // Re-vote (update) once
  r = await A.post("/api/vote", { target: assignedBy[1][0].target, scores: { level: scoreFor(slotOfGen[assignedBy[1][0].target]), enemy: scoreFor(slotOfGen[assignedBy[1][0].target]), ability: scoreFor(slotOfGen[assignedBy[1][0].target]), puzzle: scoreFor(slotOfGen[assignedBy[1][0].target]) } });
  expect(r.status === 200 && r.json.done === 4 && r.json.total === 4, "all teams voted; re-vote updates (done 4/4)");
  as = await admin.state("admin");
  expect(as.totals.votesCast === 28 && as.totals.votesAssigned === 28 && as.totals.votersDone === 7, "admin votes progress 28/28, 7 voters done");
  const votedItems = (await admin.state("admin", 0)).feed.filter((f) => f.type === "voted");
  expect(votedItems.length === 28, "feed 'voted' logged once per voter-target (28)");
  sA = await A.state();
  expect(sA.voting.assigned.every((d) => d.myVote), "team sees its own votes");

  // REVEAL
  r = await admin.post("/api/admin/reveal", { action: "next" });
  expect(r.status === 409, "reveal outside REVEAL is rejected");
  r = await admin.post("/api/admin/phase", { phase: "REVEAL" });
  expect(r.status === 200 && r.json.phase === "REVEAL", "phase -> REVEAL");
  as = await admin.state("admin");
  const scr = await admin.state("screen");
  expect(Array.isArray(as.ranking) && as.ranking.length === 7 && scr.ranking === null, "full ranking for admin only, not screen");
  expect(as.ranking[0].slot === 3 && as.ranking[1].slot === 5 && as.ranking[2].slot === 1 && as.ranking[0].score === 5, `ranking order correct (${as.ranking.slice(0, 3).map((x) => x.slot).join(",")})`);
  expect(as.reveal.step === 0 && as.reveal.maxStep === 3 && as.reveal.revealed.length === 0, "reveal starts at step 0 of 3");
  sA = await A.state();
  expect(sA.reveal && sA.reveal.revealed.length === 0 && !("ranking" in sA), "team sees nothing revealed yet");
  r = await admin.post("/api/admin/reveal", { action: "next" });
  expect(r.status === 200 && r.json.reveal.step === 1 && r.json.reveal.revealed[0].rank === 3 && r.json.reveal.revealed[0].slot === 1, "step 1 reveals 3rd place");
  r = await A.post("/api/team/name", { name: "Renamed On Stage" });
  expect(r.status === 200, "rename allowed during REVEAL");
  as = await admin.state("admin");
  expect(as.reveal.revealed[0].name === "Renamed On Stage", "podium shows the new name after a rename");
  r = await A.post("/api/team/name", { name: "The Night Shift" });
  r = await admin.post("/api/admin/reveal", { action: "next" });
  expect(r.json.reveal.step === 2 && r.json.reveal.revealed.map((x) => x.rank).join() === "3,2", "step 2 reveals 2nd place");
  r = await admin.post("/api/admin/reveal", { action: "next" });
  expect(r.json.reveal.step === 3 && r.json.reveal.revealed.map((x) => x.rank).join() === "3,2,1" && r.json.reveal.revealed[2].slot === 3, "step 3 reveals the winner last");
  r = await admin.post("/api/admin/reveal", { action: "next" });
  expect(r.json.reveal.step === 3, "next past the winner stays at 3");
  const scr2 = await admin.state("screen");
  sB = await B.state();
  expect(scr2.reveal.revealed.length === 3 && sB.reveal.revealed.length === 3, "screen and teams see the revealed podium");
  r = await admin.post("/api/admin/reveal", { action: "reset" });
  expect(r.json.reveal.step === 0, "reveal reset");

  // Reset budget
  sA = await A.state();
  r = await admin.post("/api/admin/team/1/reset-budget");
  expect(r.status === 200 && r.json.team.spendUsd === 0 && r.json.team.reservedUsd === 0, `reset budget for team 1 (was $${sA.team.spendUsd})`);
  sA = await A.state();
  expect(sA.team.spendUsd === 0 && sA.generations.length >= 5, "team keeps its work after budget reset");

  // CLOSED + illegal jump
  r = await admin.post("/api/admin/phase", { phase: "CLOSED" });
  expect(r.status === 200 && r.json.phase === "CLOSED", "phase -> CLOSED");
  r = await admin.post("/api/admin/phase", { phase: "DESIGN" });
  expect(r.status === 409, "CLOSED -> DESIGN jump rejected");

  // Reset event: epoch bump logs out teams, keeps this admin
  r = await admin.post("/api/admin/reset-event", { confirm: "NEW GAME" });
  expect(r.status === 200 && r.json.epoch === epoch1 + 1 && r.json.previousGame === epoch1, `new game bumps epoch to ${r.json.epoch}, saves game ${r.json.previousGame}`);
  // The finished game is kept: listed under past games, with its storyboards, podium and working image links.
  r = await admin.get("/api/admin/games");
  const pastGame = r.json.games?.find((g) => g.id === epoch1);
  const liveGame = r.json.games?.find((g) => g.id === epoch1 + 1);
  expect(r.status === 200 && pastGame && !pastGame.current && pastGame.teams >= 2 && pastGame.generations >= 5 && liveGame?.current, "past game listed with its counts; new game is live");
  r = await admin.get(`/api/admin/games/${epoch1}`);
  const pastImg = r.json.generations?.find((g) => g.imageUrl)?.imageUrl;
  expect(r.status === 200 && r.json.ranking?.length > 0 && r.json.teams?.length >= 2 && pastImg, "past game detail has ranking, teams and storyboards");
  const imgRes = await fetch(pastImg);
  expect(imgRes.status === 200, "past game's storyboard image is still in Blob (not deleted)");
  r = await admin.get(`/api/admin/games/${epoch1 + 1}`);
  expect(r.status === 404, "live game has no snapshot yet");
  sA = await A.state();
  expect(sA.role === "anon" && sA.sessionExpired === true, "old team cookie is invalid after reset (sessionExpired)");
  r = await B.post("/api/team/name", { name: "ghost" });
  expect(r.status === 401, "old team cookie rejected on actions");
  as = await admin.state("admin");
  expect(as.role === "admin" && as.teams.length === 0 && as.feed.length === 0 && as.totals.totalSpendUsd === 0 && as.phase === "LOBBY", "admin still logged in; dashboard empty");
  r = await A.post("/api/join", { code: CODES[0] });
  expect(r.status === 200 && r.json.team.name === "Team 1" && r.json.firstJoin, "rejoin after reset starts fresh as Team 1");
  r = await admin.post("/api/admin/logout");
  as = await admin.state("admin");
  expect(as.role === "anon", "admin logout");

  // Leave the server in a clean state.
  await admin.post("/api/admin/login", { code: ADMIN });
  await admin.post("/api/admin/reset-event", { confirm: "RESET" });
  console.log(`\nsmoke: PASS (${step} checks, ${((Date.now() - t0) / 1000).toFixed(1)}s)`);
}

main().catch((e) => fail(`unexpected exception: ${e?.stack || e}`));
