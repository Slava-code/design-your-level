// Team-facing budgets are shown as credits, never dollars. 1 credit = $0.01 of real OpenAI cost,
// so TEAM_BUDGET_USD=5 shows as 500 credits. The database and the admin's OpenAI spend stay in dollars.
export const CREDITS_PER_USD = 100;

/** Dollars -> whole credits (rounded). */
export const toCredits = (usd: number) => Math.max(0, Math.round((Number(usd) || 0) * CREDITS_PER_USD));

/** "1 credit" / "42 credits". */
export const creditsLabel = (usd: number) => {
  const n = toCredits(usd);
  return `${n} ${n === 1 ? "credit" : "credits"}`;
};

/** Credits left, computed so that spent + left always adds up to the budget on screen. */
export const creditsLeft = (budgetUsd: number, spentUsd: number) => Math.max(0, toCredits(budgetUsd) - toCredits(spentUsd));
