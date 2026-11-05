// Real OpenAI implementations of the AI layer. To be written by the AI-layer worker (see docs/CONTRACT.md).
import "server-only";
import type { DesignInput, QA, AiCost, PromptResult, StoryboardResult, RefImage } from "./index";

const todo = (): never => {
  throw new Error("AI layer not implemented yet (set MOCK_AI=1)");
};
export async function moderate(_t: string): Promise<{ flagged: boolean; categories: string[] }> { return todo(); }
export async function askFollowups(_d: DesignInput): Promise<{ questions: string[]; cost: AiCost; ms: number }> { return todo(); }
export async function writeImagePrompt(_d: DesignInput, _qa: QA[]): Promise<PromptResult> { return todo(); }
export async function generateStoryboard(_p: string, _r: RefImage[]): Promise<StoryboardResult> { return todo(); }
