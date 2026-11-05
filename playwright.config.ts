// Playwright config for the full dry run (e2e/*.spec.ts).
//
//   NEXT_DIST_DIR=.next-qa npm run build        # once, after code changes
//   npm run test:e2e                            # starts `next start` on :3601 in mock mode and runs the spec
//
// Safety: the server runs with MOCK_AI=1 (no OpenAI spend; E2E_REAL_AI=1 is the one exception, for e2e/real-ai.spec.ts) and a dev database (DEV_DB_NAME,
// default dyl_dev_qa). A production build would otherwise use the production database, so this
// config refuses to run without a dev DB name. Codes are read from .env.local and never printed.
import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";
import path from "node:path";

const envFile = path.join(__dirname, ".env.local");
if (existsSync(envFile)) process.loadEnvFile(envFile); // does not override variables already set

const PORT = Number(process.env.E2E_PORT || 3601);
const DIST = process.env.NEXT_DIST_DIR || ".next-qa";
const DB = process.env.DEV_DB_NAME || "dyl_dev_qa";
if (!/^dyl_dev_/.test(DB)) throw new Error(`Refusing to run e2e against database "${DB}" (must be a dyl_dev_* database).`);
process.env.DEV_DB_NAME = DB;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
if (/mottonote\.app/.test(BASE_URL)) throw new Error("Refusing to run the e2e suite against production.");

export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.spec\.ts/,
  outputDir: "test-results/artifacts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 6 * 60_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: {
    baseURL: BASE_URL,
    channel: "chrome", // the system Chrome; never downloads a browser
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    actionTimeout: 15_000,
  },
  webServer: process.env.E2E_NO_SERVER
    ? undefined
    : {
        command: `npx next start -p ${PORT}`,
        url: `${BASE_URL}/api/state`,
        reuseExistingServer: !!process.env.E2E_REUSE,
        timeout: 60_000,
        stdout: "ignore",
        stderr: "pipe",
        env: {
          NEXT_DIST_DIR: DIST,
          DEV_DB_NAME: DB,
          // Mock AI ($0) unless the one real-AI spec is run on purpose with E2E_REAL_AI=1.
          MOCK_AI: process.env.E2E_REAL_AI === "1" ? "0" : "1",
          MOCK_AI_DELAY_MS: process.env.MOCK_AI_DELAY_MS || "250",
          ALLOW_DEV_ROUTES: "1",
        },
      },
});
