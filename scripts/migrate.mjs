#!/usr/bin/env node
// Applies db/schema.sql (idempotent) to one or more databases on the Neon server.
//
// Usage:
//   node scripts/migrate.mjs                 -> DEV_DB_NAME if set, else all dev databases
//   DEV_DB_NAME=dyl_dev_backend node scripts/migrate.mjs
//   node scripts/migrate.mjs --db dyl_dev_team
//   node scripts/migrate.mjs --dev           -> all dev databases (dyl_dev_backend, _team, _admin, _qa)
//   node scripts/migrate.mjs --prod          -> production database (the one named in DATABASE_URL_UNPOOLED)
//   node scripts/migrate.mjs --all           -> production + all dev databases
//
// Reads DATABASE_URL_UNPOOLED (falls back to DATABASE_URL) from the environment or .env.local.
// Never prints connection strings or credentials. Creates a missing dev database.
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { neon } from "@neondatabase/serverless";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envFile = path.join(root, ".env.local");
if (existsSync(envFile)) process.loadEnvFile(envFile); // does not override variables already set

const DEV_DBS = ["dyl_dev_backend", "dyl_dev_team", "dyl_dev_admin", "dyl_dev_qa"];
const baseUrl = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!baseUrl) {
  console.error("migrate: DATABASE_URL_UNPOOLED / DATABASE_URL not set");
  process.exit(1);
}
const prodDb = new URL(baseUrl).pathname.replace(/^\//, "") || "neondb";

const args = process.argv.slice(2);
let targets;
if (args.includes("--all")) targets = [prodDb, ...DEV_DBS];
else if (args.includes("--prod")) targets = [prodDb];
else if (args.includes("--dev")) targets = DEV_DBS;
else if (args.includes("--db")) targets = [args[args.indexOf("--db") + 1]];
else if (process.env.DEV_DB_NAME) targets = [process.env.DEV_DB_NAME];
else targets = DEV_DBS;

for (const t of targets) {
  if (!t || !/^[a-z_][a-z0-9_]*$/.test(t)) {
    console.error(`migrate: invalid database name "${t}"`);
    process.exit(1);
  }
}

const withDb = (db) => {
  const u = new URL(baseUrl);
  u.pathname = "/" + db;
  return u.toString();
};

const schema = readFileSync(path.join(root, "db", "schema.sql"), "utf8");
const statements = schema
  .split(/;\s*$/m)
  .map((s) =>
    s
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n")
      .trim(),
  )
  .filter(Boolean);

async function ensureDatabase(db) {
  if (db === prodDb) return;
  const admin = neon(withDb(prodDb));
  const rows = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [db]);
  if (rows.length === 0) {
    await admin.query(`CREATE DATABASE "${db}"`);
    console.log(`migrate: created database ${db}`);
  }
}

let failed = false;
for (const db of targets) {
  try {
    await ensureDatabase(db);
    const sql = neon(withDb(db));
    for (const st of statements) await sql.query(st);
    const [{ epoch, phase }] = await sql.query("SELECT epoch, phase FROM event_state WHERE id = 1");
    console.log(`migrate: ${db} ok (${statements.length} statements; phase ${phase}, epoch ${epoch})`);
  } catch (e) {
    failed = true;
    console.error(`migrate: ${db} FAILED: ${e?.message ?? e}`);
  }
}
process.exit(failed ? 1 : 0);
