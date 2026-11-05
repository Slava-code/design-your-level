// End-to-end through the public entry (src/lib/ai/index.ts) with the default settings, exactly as the backend
// calls it. MOCK_AI=1 spike/e2e.sh -> mock path ($0); spike/e2e.sh -> real path (~$0.05).
import * as nodeModule from "node:module";
import { readFileSync, writeFileSync, existsSync, appendFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
(nodeModule as any).registerHooks({
  resolve(specifier: string, context: { parentURL?: string }, next: (s: string, c: unknown) => unknown) {
    if ((specifier.startsWith("./") || specifier.startsWith("../")) && !/\.[cm]?[jt]sx?$/.test(specifier) && context.parentURL) {
      const c = new URL(specifier + ".ts", context.parentURL);
      if (existsSync(fileURLToPath(c))) return next(c.href, context);
    }
    return next(specifier, context);
  },
});
for (const line of readFileSync(join(ROOT, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
}
const ai = await import(pathToFileURL(join(ROOT, "src/lib/ai/index.ts")).href);
const { byId } = await import(pathToFileURL(join(HERE, "designs.mts")).href);
const d = byId(process.argv[2] || "greenhouse");
const input = { genre: d.genre, feeling: d.feeling, artStyle: d.artStyle, level: d.level, enemy: d.enemy, ability: d.ability, puzzle: d.puzzle,
  references: d.refs.map((r: any) => ({ url: `data:image/jpeg;base64,${readFileSync(r.file).toString("base64")}`, field: r.field })) };
console.log("MODELS", ai.MODELS, "mock", ai.isMock(), "est gen", ai.estimateGenerationUsd(input.references.length), "est fu", ai.estimateFollowupUsd(input.references.length));
let t = Date.now();
const mod = await ai.moderate(Object.values(input).filter((v) => typeof v === "string").join("\n"));
console.log("moderate", mod, Date.now() - t, "ms");
const fu = await ai.askFollowups(input);
console.log("followups", fu.questions, fu.ms, "ms", fu.cost.usd);
const qa = fu.questions.map((q: string, i: number) => ({ q, a: i === 0 ? "near the entrance" : "" }));
const pr = await ai.writeImagePrompt(input, qa);
console.log("prompt", pr.ms, "ms", pr.cost.usd, pr.panelCaptions, pr.changesMade);
const img = await ai.generateStoryboard(pr.imagePrompt, input.references);
console.log("image", img.ok, img.ms, "ms", img.cost.usd, img.ok ? img.contentType + " " + img.bytes.length : img.reason);
if (img.ok) { mkdirSync(join(HERE, "out", "e2e"), { recursive: true }); writeFileSync(join(HERE, "out", "e2e", `${d.id}${ai.isMock() ? "-mock.svg" : ".jpg"}`), img.bytes); }
if (!ai.isMock()) appendFileSync(join(HERE, "out", "ledger.jsonl"), JSON.stringify({ ts: new Date().toISOString(), kind: "e2e", design: d.id, usd: fu.cost.usd + pr.cost.usd + img.cost.usd, ms: Date.now() - t }) + "\n");
console.log("total ms", Date.now() - t);
