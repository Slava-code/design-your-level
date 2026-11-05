#!/usr/bin/env node
// Generates team join codes, the admin code and the session secret into .env.local.
// Codes never get committed: .env.local and print/ are gitignored.
//
//   node scripts/gen-codes.mjs            # only fills values that are empty
//   node scripts/gen-codes.mjs --force    # regenerate everything (invalidates printed cards!)
//   TEAMS=12 node scripts/gen-codes.mjs
//
// Words: EFF large wordlist (CC BY 3.0, https://www.eff.org/dice), filtered to
// short, hyphen-free words so codes are easy to type on a phone.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { randomInt, randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = join(root, ".env.local");
const force = process.argv.includes("--force");
const TEAMS = Number(process.env.TEAMS || 12);

const words = readFileSync(join(root, "scripts/eff_large_wordlist.txt"), "utf8")
  .split("\n")
  .map((l) => l.split("\t")[1]?.trim())
  .filter((w) => w && /^[a-z]{3,7}$/.test(w));

const pick = () => words[randomInt(words.length)];
const code = (n) => Array.from({ length: n }, pick).join("-");

const lines = existsSync(envPath) ? readFileSync(envPath, "utf8").split("\n") : [];
const get = (k) => lines.find((l) => l.startsWith(k + "="))?.slice(k.length + 1).replace(/^"|"$/g, "") ?? "";
const set = (k, v) => {
  const i = lines.findIndex((l) => l.startsWith(k + "="));
  if (i >= 0) lines[i] = `${k}=${v}`;
  else lines.push(`${k}=${v}`);
};

const want = {
  TEAM_CODES: () => {
    const s = new Set();
    while (s.size < TEAMS) s.add(code(3));
    return [...s].join(",");
  },
  ADMIN_CODE: () => code(5),
  SESSION_SECRET: () => randomBytes(32).toString("hex"),
  TEAM_BUDGET_USD: () => "5",
};

const changed = [];
for (const [k, gen] of Object.entries(want)) {
  if (force || !get(k)) {
    set(k, gen());
    changed.push(k);
  }
}
writeFileSync(envPath, lines.join("\n").replace(/\n*$/, "\n"), { mode: 0o600 });
console.log(
  `wordlist: ${words.length} words -> ${(3 * Math.log2(words.length)).toFixed(1)} bits per team code`,
);
console.log(changed.length ? `set: ${changed.join(", ")}` : "nothing to change (use --force to regenerate)");
