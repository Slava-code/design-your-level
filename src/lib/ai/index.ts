// AI layer: public interface (see docs/CONTRACT.md). Real implementations live in ./openai.ts;
// MOCK_AI=1 returns canned results at zero cost so UI work and e2e tests never touch the API.
import "server-only";

export type RefField = "genre" | "feeling" | "artStyle" | "level" | "enemy" | "ability" | "puzzle" | "general";
export type RefImage = { url: string; field: RefField };
export type DesignInput = {
  genre: string;
  feeling: string;
  artStyle: string;
  level: string;
  enemy: string;
  ability: string;
  puzzle: string;
  references: RefImage[];
};
export type QA = { q: string; a: string };
export type AiCost = { usd: number; detail: Record<string, number> };
export type PromptResult = {
  imagePrompt: string;
  panelCaptions: string[];
  referenceRoles: string[];
  changesMade: string[];
  cost: AiCost;
  ms: number;
};
export type StoryboardResult =
  | { ok: true; bytes: Uint8Array; contentType: string; cost: AiCost; ms: number }
  | { ok: false; refused: boolean; reason: string; cost: AiCost; ms: number };

export const MODELS = {
  text: process.env.TEXT_MODEL || "gpt-6-luna",
  image: process.env.IMAGE_MODEL || "gpt-image-2.6-flare",
};

export const isMock = () => process.env.MOCK_AI === "1";

const zero: AiCost = { usd: 0, detail: {} };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const mockDelay = () => Number(process.env.MOCK_AI_DELAY_MS || 1500);

export async function moderate(text: string): Promise<{ flagged: boolean; categories: string[] }> {
  if (isMock()) {
    // Lets tests exercise the flagged path deterministically.
    return text.includes("MOCK_FLAG") ? { flagged: true, categories: ["mock"] } : { flagged: false, categories: [] };
  }
  return (await import("./openai")).moderate(text);
}

export async function askFollowups(d: DesignInput): Promise<{ questions: string[]; cost: AiCost; ms: number }> {
  if (isMock()) {
    await sleep(mockDelay());
    const questions = d.level.includes("MOCK_CLEAR")
      ? []
      : [
          "What does the first room look like when the player walks in?",
          "How does the player know the enemy is close before they see it?",
          "Where exactly is the ability hidden?",
        ];
    return { questions, cost: zero, ms: mockDelay() };
  }
  return (await import("./openai")).askFollowups(d);
}

export async function writeImagePrompt(d: DesignInput, qa: QA[]): Promise<PromptResult> {
  if (isMock()) {
    await sleep(mockDelay());
    return {
      imagePrompt: `MOCK prompt. 2x2 storyboard, ${d.artStyle || "any style"}, feeling: ${d.feeling}. Level: ${d.level}. Enemy: ${d.enemy}. Ability: ${d.ability}. Puzzle: ${d.puzzle}. Answers: ${qa.map((x) => x.a).join(" / ")}`,
      panelCaptions: ["Entering the level", "The enemy encounter", "Finding the ability", "Solving the puzzle at the exit"],
      referenceRoles: d.references.map((r, i) => `image ${i + 1} = ${r.field}`),
      changesMade: d.enemy.includes("MOCK_SOFTEN") ? ["Made the gore implied instead of shown"] : [],
      cost: zero,
      ms: mockDelay(),
    };
  }
  return (await import("./openai")).writeImagePrompt(d, qa);
}

export async function generateStoryboard(imagePrompt: string, refs: RefImage[]): Promise<StoryboardResult> {
  if (isMock()) {
    await sleep(mockDelay() * 2);
    if (imagePrompt.includes("MOCK_REFUSE")) {
      return { ok: false, refused: true, reason: "Mock refusal", cost: { usd: 0.01, detail: { mock: 0.01 } }, ms: mockDelay() * 2 };
    }
    return { ok: true, bytes: new TextEncoder().encode(mockSvg(imagePrompt)), contentType: "image/svg+xml", cost: zero, ms: mockDelay() * 2 };
  }
  return (await import("./openai")).generateStoryboard(imagePrompt, refs);
}

/** Conservative upper bound reserved against a team's budget before a generation starts. */
export function estimateGenerationUsd(nRefs: number): number {
  return 0.6 + 0.05 * nRefs; // placeholder until spike/RESULTS.md measures real costs
}

export function estimateFollowupUsd(nRefs: number): number {
  return 0.02 + 0.005 * nRefs;
}

function mockSvg(prompt: string): string {
  const esc = (s: string) => s.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]!);
  const hue = [...prompt].reduce((a, c) => (a + c.charCodeAt(0)) % 360, 0);
  const labels = ["1 ENTER", "2 ENEMY", "3 ABILITY", "4 PUZZLE / EXIT"];
  const cells = labels
    .map((l, i) => {
      const x = (i % 2) * 768, y = Math.floor(i / 2) * 512;
      return `<rect x="${x + 8}" y="${y + 8}" width="752" height="496" fill="hsl(${(hue + i * 40) % 360} 40% 22%)" stroke="#7CFF9B" stroke-width="4"/>
<text x="${x + 384}" y="${y + 256}" font-family="monospace" font-size="44" fill="#7CFF9B" text-anchor="middle">${l}</text>`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1536" height="1024" viewBox="0 0 1536 1024"><rect width="1536" height="1024" fill="#06140B"/>${cells}<text x="768" y="1010" font-family="monospace" font-size="18" fill="#E9DCBC" text-anchor="middle">${esc(prompt.slice(0, 120))}</text></svg>`;
}
