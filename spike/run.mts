// Model spike runner. Exercises the real src/lib/ai/openai.ts against the OpenAI API.
//
//   node --conditions=react-server spike/run.mts <cmd> <designId> [--flags]
//
//   moderate  <id>                          omni moderation on the raw design text (free)
//   followups <id> [--effort=low]           Luna follow-up questions -> spike/out/<id>/followups.json
//   prompt    <id> [--effort=low]           Luna image prompt (answers from spike/answers/<id>.json) -> prompt.json
//   image     <id> [--model=flare|sunburst|<full>] [--quality=high] [--complexity=..] [--moderation=low]
//                  [--tag=name] [--refs=file1,file2] [--raw]   (--raw: prompt = the raw design text, no Luna)
//   spend                                   total real spend so far (spike/out/ledger.jsonl)
//
// Loads .env.local itself without printing anything from it. Hard cap: SPEND_CAP_USD (default 8).
import * as nodeModule from "node:module";
import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const OUT = join(HERE, "out");
const LEDGER = join(OUT, "ledger.jsonl");
const CAP = Number(process.env.SPEND_CAP_USD || 8);

// Let Node's type stripping load the app's extensionless TS imports ("./config" -> "./config.ts").
// registerHooks exists in Node >= 22.15; @types/node 20 does not declare it.
(nodeModule as any).registerHooks({
  resolve(specifier: string, context: { parentURL?: string }, next: (s: string, c: unknown) => unknown) {
    if ((specifier.startsWith("./") || specifier.startsWith("../")) && !/\.[cm]?[jt]sx?$/.test(specifier) && context.parentURL) {
      const candidate = new URL(specifier + ".ts", context.parentURL);
      if (existsSync(fileURLToPath(candidate))) return next(candidate.href, context);
    }
    return next(specifier, context);
  },
});

// Minimal .env.local loader (values never printed).
for (const line of readFileSync(join(ROOT, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (!m || process.env[m[1]] !== undefined) continue;
  let v = m[2];
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  process.env[m[1]] = v;
}
delete process.env.MOCK_AI;

const ai = await import(pathToFileURL(join(ROOT, "src/lib/ai/openai.ts")).href);
const { byId } = await import(pathToFileURL(join(HERE, "designs.mts")).href);

const [cmd, id, ...rest] = process.argv.slice(2);
const flags: Record<string, string> = Object.fromEntries(
  rest.filter((a) => a.startsWith("--")).map((a) => {
    const [k, v] = a.slice(2).split("=");
    return [k, v ?? "1"];
  }),
);

function spent(): number {
  if (!existsSync(LEDGER)) return 0;
  return readFileSync(LEDGER, "utf8").trim().split("\n").filter(Boolean).reduce((s, l) => s + (JSON.parse(l).usd || 0), 0);
}
function guard(estimate: number) {
  const s = spent();
  if (s + estimate > CAP) {
    console.error(`spend cap: spent $${s.toFixed(3)} + est $${estimate} > $${CAP}`);
    process.exit(2);
  }
}
function record(row: Record<string, unknown>) {
  mkdirSync(OUT, { recursive: true });
  appendFileSync(LEDGER, JSON.stringify({ ts: new Date().toISOString(), ...row }) + "\n");
}
const mimeOf = (f: string) => (/\.png$/i.test(f) ? "image/png" : /\.webp$/i.test(f) ? "image/webp" : "image/jpeg");
const dataUrl = (f: string) => `data:${mimeOf(f)};base64,${readFileSync(f).toString("base64")}`;

function designInput(d: any) {
  const files: string[] = flags.refs ? flags.refs.split(",") : d.refs.map((r: any) => r.file);
  const references = files.map((f, i) => ({ url: dataUrl(f), field: d.refs[i]?.field ?? "general" }));
  return { genre: d.genre, feeling: d.feeling, artStyle: d.artStyle, level: d.level, enemy: d.enemy, ability: d.ability, puzzle: d.puzzle, references };
}
const rawText = (d: any) =>
  [d.genre, d.feeling, d.artStyle, d.level, d.enemy, d.ability, d.puzzle].filter(Boolean).join("\n");

const MODEL_ALIAS: Record<string, string> = { flare: "gpt-image-2.6-flare", sunburst: "gpt-image-2.6-sunburst" };

if (cmd === "spend") {
  console.log(`total real spend: $${spent().toFixed(4)} (cap $${CAP})`);
  process.exit(0);
}

const d = byId(id);
const dir = join(OUT, d.id);
mkdirSync(dir, { recursive: true });

if (cmd === "moderate") {
  const t0 = Date.now();
  const r = await ai.moderate(rawText(d));
  console.log(JSON.stringify({ ...r, ms: Date.now() - t0 }));
} else if (cmd === "followups") {
  guard(0.01);
  const r = await ai.askFollowups(designInput(d), { effort: flags.effort });
  record({ kind: "followups", design: d.id, effort: flags.effort ?? "default", usd: r.cost.usd, ms: r.ms, detail: r.cost.detail, n: r.questions.length });
  writeFileSync(join(dir, `followups${flags.tag ? "-" + flags.tag : ""}.json`), JSON.stringify(r, null, 2));
  console.log(JSON.stringify({ ms: r.ms, usd: r.cost.usd, questions: r.questions }, null, 2));
} else if (cmd === "prompt") {
  guard(0.02);
  const ansFile = join(HERE, "answers", `${d.id}.json`);
  const qa = existsSync(ansFile) ? JSON.parse(readFileSync(ansFile, "utf8")) : [];
  const r = await ai.writeImagePrompt(designInput(d), qa, { effort: flags.effort });
  record({ kind: "prompt", design: d.id, effort: flags.effort ?? "default", usd: r.cost.usd, ms: r.ms, detail: r.cost.detail });
  writeFileSync(join(dir, `prompt${flags.tag ? "-" + flags.tag : ""}.json`), JSON.stringify(r, null, 2));
  console.log(JSON.stringify(r, null, 2));
} else if (cmd === "image") {
  guard(0.3);
  const model = MODEL_ALIAS[flags.model ?? "flare"] ?? flags.model;
  const quality = flags.quality ?? "high";
  let prompt: string;
  if (flags.raw) prompt = rawText(d);
  else {
    const pf = join(dir, `prompt${flags.ptag ? "-" + flags.ptag : ""}.json`);
    prompt = JSON.parse(readFileSync(pf, "utf8")).imagePrompt;
  }
  const refs = designInput(d).references;
  const r = await ai.generateStoryboard(prompt, refs, {
    model,
    quality,
    complexity: flags.complexity,
    moderation: flags.moderation,
  });
  const short = model.replace("gpt-image-2.6-", "");
  const name = `${short}-${quality}${flags.complexity ? "-c" + flags.complexity : ""}${flags.tag ? "-" + flags.tag : ""}`;
  if (r.ok) writeFileSync(join(dir, `${name}.jpg`), r.bytes);
  record({ kind: "image", design: d.id, model, quality, complexity: flags.complexity, raw: !!flags.raw, refs: refs.length, tag: flags.tag, ok: r.ok, refused: r.ok ? false : r.refused, reason: r.ok ? undefined : r.reason, usd: r.cost.usd, ms: r.ms, detail: r.cost.detail, bytes: r.ok ? r.bytes.length : 0 });
  console.log(JSON.stringify({ name, ok: r.ok, ms: r.ms, usd: r.cost.usd, detail: r.cost.detail, ...(r.ok ? { kb: Math.round(r.bytes.length / 1024), contentType: r.contentType } : { refused: r.refused, reason: r.reason }) }));
} else {
  console.error("unknown command; see header of spike/run.mts");
  process.exit(1);
}
console.error(`spend so far: $${spent().toFixed(4)}`);
