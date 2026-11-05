#!/usr/bin/env node
// Writes print/codes.html: US-letter pages of cut-out team code cards (6 per page), and
// public/qr-play.svg: a QR code for https://play.mottonote.app (for the slide deck).
//
//   node scripts/print-codes.mjs            # reads TEAM_CODES from .env.local
//   open print/codes.html                   # then print: Letter, scale 100%, margins "None" or "Default"
//
// The team codes are secrets: this script never prints them to stdout, and print/ is gitignored.
// Fonts are embedded (base64) so the page prints the same offline.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import QRCode from "qrcode";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PLAY_HOST = "play.mottonote.app";
const PLAY_URL = `https://${PLAY_HOST}`;

function readCodes() {
  if (process.env.TEAM_CODES) return process.env.TEAM_CODES;
  const envPath = join(root, ".env.local");
  if (!existsSync(envPath)) throw new Error(".env.local not found (run scripts/gen-codes.mjs first)");
  const line = readFileSync(envPath, "utf8")
    .split("\n")
    .find((l) => l.startsWith("TEAM_CODES="));
  if (!line) throw new Error("TEAM_CODES is not set in .env.local");
  return line.slice("TEAM_CODES=".length).replace(/^["']|["']$/g, "");
}

const codes = readCodes()
  .split(",")
  .map((c) => c.trim())
  .filter(Boolean);
if (!codes.length) throw new Error("TEAM_CODES is empty");

const font = (file) => {
  const p = join(root, "public/fonts", file);
  return existsSync(p) ? `url(data:font/woff2;base64,${readFileSync(p).toString("base64")}) format("woff2")` : "local(Arial)";
};
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// QR for the cards (ink on transparent) and the deck file (ink on parchment-free white for max contrast).
const qrCard = await QRCode.toString(PLAY_URL, { type: "svg", errorCorrectionLevel: "M", margin: 0, color: { dark: "#1A120AFF", light: "#00000000" } });
const qrDeck = await QRCode.toString(PLAY_URL, { type: "svg", errorCorrectionLevel: "M", margin: 2, color: { dark: "#1A120AFF", light: "#FFFFFFFF" } });
writeFileSync(join(root, "public/qr-play.svg"), qrDeck);

/** Font size (pt) so the whole code fits on one line of the card. VT323 advance is about 0.5em. */
function codeSize(code) {
  const usable = 222; // pt of line width inside the code box
  return Math.max(16, Math.min(34, usable / (code.length * 0.6)));
}

const card = (code, i) => {
  const slot = i + 1;
  const parts = code.split("-");
  const codeHtml = parts.map((w) => `<span class="w">${esc(w)}</span>`).join('<span class="h">-</span>');
  return `
  <article class="card">
    <header class="band">
      <span class="prompt">&gt;</span><span class="design">DESIGN</span><span class="your">Your</span><span class="level">Level</span>
      <span class="course">ENGL 175</span>
    </header>
    <div class="body">
      <div class="top">
        <div class="teamBox">
          <div class="label">your team</div>
          <div class="team">Team ${slot}</div>
        </div>
        <div class="qr" aria-label="QR code for ${PLAY_HOST}">${qrCard}</div>
      </div>
      <div class="label">team code</div>
      <div class="code" style="font-size:${codeSize(code).toFixed(1)}pt"><span class="fit">${codeHtml}</span></div>
      <div class="go">Go to <b>${PLAY_HOST}</b></div>
      <p class="how">Pick one typist: type this code on one phone or laptop and press Join. Teammates can follow along with the same code.</p>
    </div>
  </article>`;
};

const pages = [];
for (let i = 0; i < codes.length; i += 6) pages.push(codes.slice(i, i + 6).map((c, k) => card(c, i + k)).join(""));

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="robots" content="noindex">
<title>Design Your Level - team code cards (do not share)</title>
<style>
@font-face { font-family: "VT323"; src: ${font("vt323-400-latin.woff2")}; }
@font-face { font-family: "Special Elite"; src: ${font("special-elite-400-latin.woff2")}; }
@font-face { font-family: "Bricolage"; src: ${font("bricolage-grotesque-var-latin.woff2")}; font-weight: 700 800; }
@font-face { font-family: "Plex"; src: ${font("ibm-plex-sans-var-latin.woff2")}; font-weight: 100 700; }
@page { size: letter; margin: 0; }
* { box-sizing: border-box; margin: 0; padding: 0; }
html { background: #5a5048; }
body { font-family: "Plex", Arial, sans-serif; color: #1a120a; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.sheet { width: 8.5in; height: 11in; margin: 0.3in auto; background: #fff; padding: 0.45in 0.5in; display: grid;
  grid-template-columns: 1fr 1fr; grid-template-rows: repeat(3, 1fr); position: relative; box-shadow: 0 6px 30px rgba(0,0,0,.4); }
.sheet::before, .sheet::after { content: ""; position: absolute; pointer-events: none; }
/* cut guides */
.sheet::before { left: 50%; top: 0.2in; bottom: 0.2in; border-left: 1px dashed #9c8a74; }
.sheet::after { left: 0.2in; right: 0.2in; top: calc(0.45in + (11in - 0.9in) / 3); height: calc((11in - 0.9in) / 3);
  border-top: 1px dashed #9c8a74; border-bottom: 1px dashed #9c8a74; }
.card { margin: 0.14in; border: 2px solid #1a120a; border-radius: 10px; overflow: hidden; display: flex; flex-direction: column;
  background: #fbf6ea; position: relative; }
.card::after { content: ""; position: absolute; right: -18px; bottom: -18px; width: 70px; height: 70px; border-radius: 50%;
  background: radial-gradient(circle, rgba(166,124,78,.28), rgba(166,124,78,0) 70%); }
.band { display: flex; align-items: baseline; gap: 4pt; padding: 5pt 10pt 4pt; background: #1a120a; color: #e9dcbc; }
.prompt, .design { font-family: "VT323", monospace; font-size: 15pt; letter-spacing: .08em; color: #7cff9b; }
.prompt { color: #4fd774; }
.your { font-family: "Special Elite", monospace; font-size: 10pt; margin-left: 4pt; color: #cda676; }
.level { font-family: "Bricolage", Arial Black, sans-serif; font-weight: 800; font-size: 13pt; color: #e9dcbc; }
.course { margin-left: auto; font-family: "VT323", monospace; font-size: 11pt; letter-spacing: .12em; color: #cda676; }
.body { flex: 1; padding: 8pt 12pt 9pt; display: flex; flex-direction: column; }
.top { display: flex; justify-content: space-between; align-items: flex-start; gap: 8pt; }
.label { font-family: "Special Elite", monospace; font-size: 8.5pt; text-transform: uppercase; letter-spacing: .12em; color: #6b4a28; }
.team { font-family: "Bricolage", Arial Black, sans-serif; font-weight: 800; font-size: 34pt; line-height: .95; letter-spacing: -.02em; }
.qr { width: 0.95in; height: 0.95in; flex: none; padding: 3pt; border: 1.5px solid #1a120a; border-radius: 4px; background: #fff; }
.qr svg { width: 100%; height: 100%; display: block; }
.code { margin: 2pt 0 6pt; padding: 3pt 8pt 1pt; border: 2px solid #1a120a; border-radius: 6px; background: #fff;
  font-family: "VT323", monospace; line-height: 1.05; white-space: nowrap; text-align: center; letter-spacing: .02em; }
.code .h { color: #6b4a28; padding: 0 .1em; }
.code .fit { display: inline-block; white-space: nowrap; }
.go { font-size: 11.5pt; }
.go b { font-family: "VT323", monospace; font-weight: 400; font-size: 15pt; letter-spacing: .02em; }
.how { margin-top: 2pt; font-size: 8.5pt; line-height: 1.3; color: #3a2a1a; }
.note { width: 8.5in; margin: 0.3in auto 0; color: #f4f1ea; font: 12px/1.4 Arial, sans-serif; }
@media print {
  html { background: #fff; }
  .sheet { margin: 0; box-shadow: none; page-break-after: always; break-after: page; }
  .sheet:last-of-type { page-break-after: auto; break-after: auto; }
  .note { display: none; }
}
</style>
</head>
<body>
<p class="note">${codes.length} team code cards on ${pages.length} page(s). Print on US Letter at 100% scale, then cut along the dashed lines. These codes are secret: do not share this file.</p>
${pages.map((p) => `<section class="sheet">${p}</section>`).join("\n")}
<script>
// Shrink any code that still overflows its box once the real font has loaded.
document.fonts.ready.then(() => {
  for (const box of document.querySelectorAll(".code")) {
    const fit = box.querySelector(".fit");
    const avail = box.clientWidth - 18;
    let size = parseFloat(box.style.fontSize);
    while (fit.scrollWidth > avail && size > 12) { size -= 0.5; box.style.fontSize = size + "pt"; }
  }
});
</script>
</body>
</html>
`;

mkdirSync(join(root, "print"), { recursive: true });
writeFileSync(join(root, "print/codes.html"), html, { mode: 0o600 });
console.log(`print/codes.html: ${codes.length} cards on ${pages.length} page(s) (codes not shown)`);
console.log("public/qr-play.svg: QR for " + PLAY_URL);
