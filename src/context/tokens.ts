// ---------------------------------------------------------------------------
// Token Counting Utilities
// ---------------------------------------------------------------------------
//
// Claude uses a BPE tokenizer. For pre-assembly budget validation we use a
// character-based approximation (~4 chars per token) which is fast and close
// enough for budget enforcement. The API returns exact token counts in
// response headers — we trust those for billing/quota, not this estimate.
//
// If exact pre-counts become critical, we can add the official tokenizer
// later as an optional dependency. For now: speed and zero deps.
// ---------------------------------------------------------------------------

/** Average characters per token for Claude's tokenizer. */
const CHARS_PER_TOKEN = 4;

/**
 * Minimum cacheable prefix length per model (in tokens).
 * From the API docs: "Shorter prompts cannot be cached, even if marked with
 * cache_control." The API silently skips caching below these thresholds.
 */
export const MIN_CACHEABLE_TOKENS: Record<string, number> = {
  "claude-opus-4-6": 4096,
  "claude-opus-4-5-20250620": 4096,
  "claude-opus-4-20250514": 1024,
  "claude-opus-4-1-20250414": 1024,
  "claude-sonnet-4-6-20260213": 1024,
  "claude-sonnet-4-5-20250514": 1024,
  "claude-sonnet-4-20250514": 1024,
  "claude-haiku-4-5-20251001": 4096,
};

/** Default minimum if model is unknown. Conservative — use the highest. */
export const MIN_CACHEABLE_TOKENS_DEFAULT = 4096;

/**
 * Get the minimum cacheable token count for a model.
 */
export function minCacheableTokens(model: string): number {
  return MIN_CACHEABLE_TOKENS[model] ?? MIN_CACHEABLE_TOKENS_DEFAULT;
}

/**
 * Estimate token count from a string.
 * Uses the ~4 chars/token heuristic which slightly overestimates
 * (better to overestimate than underestimate for budget safety).
 */
export function countTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Estimate tokens for an array of strings (summed).
 */
export function countTokensMulti(texts: string[]): number {
  let total = 0;
  for (const text of texts) {
    total += countTokens(text);
  }
  return total;
}

export class BudgetExceededError extends Error {
  constructor(
    public readonly tier: string,
    public readonly actual: number,
    public readonly budget: number,
  ) {
    super(`Token budget exceeded for ${tier}: ${actual} tokens > ${budget} budget`);
    this.name = "BudgetExceededError";
  }
}

/**
 * Assert that a text fits within a token budget.
 * Throws BudgetExceededError if exceeded.
 */
export function assertBudget(text: string, budget: number, tier?: string): void {
  const tokens = countTokens(text);
  if (tokens > budget) {
    throw new BudgetExceededError(tier ?? "unknown", tokens, budget);
  }
}

/**
 * Check if text fits within budget (non-throwing).
 */
export function fitsInBudget(text: string, budget: number): boolean {
  return countTokens(text) <= budget;
}

/**
 * Calculate remaining token capacity for a budget.
 */
export function remainingBudget(text: string, budget: number): number {
  return Math.max(0, budget - countTokens(text));
}
