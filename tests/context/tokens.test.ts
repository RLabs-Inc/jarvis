import { describe, test, expect } from "bun:test";
import {
  countTokens,
  countTokensMulti,
  assertBudget,
  fitsInBudget,
  remainingBudget,
  BudgetExceededError,
  minCacheableTokens,
  MIN_CACHEABLE_TOKENS,
  MIN_CACHEABLE_TOKENS_DEFAULT,
} from "../../src/context/tokens.ts";

describe("countTokens", () => {
  test("empty string returns 0", () => {
    expect(countTokens("")).toBe(0);
  });

  test("counts tokens as ceil(chars / 4)", () => {
    // 12 chars / 4 = 3 tokens exactly
    expect(countTokens("hello world!")).toBe(3);
  });

  test("rounds up for non-divisible lengths", () => {
    // 13 chars / 4 = 3.25 → ceil = 4
    expect(countTokens("hello world!!")).toBe(4);
  });

  test("handles single character", () => {
    expect(countTokens("a")).toBe(1);
  });

  test("handles large text", () => {
    const text = "a".repeat(80_000); // 80K chars = 20K tokens
    expect(countTokens(text)).toBe(20_000);
  });
});

describe("countTokensMulti", () => {
  test("sums tokens across multiple texts", () => {
    // 4 chars + 8 chars = 12 chars / 4 = 3 tokens
    expect(countTokensMulti(["aaaa", "bbbbbbbb"])).toBe(3);
  });

  test("empty array returns 0", () => {
    expect(countTokensMulti([])).toBe(0);
  });
});

describe("assertBudget", () => {
  test("does not throw when within budget", () => {
    expect(() => assertBudget("hello world!", 10)).not.toThrow();
  });

  test("throws BudgetExceededError when over budget", () => {
    expect(() => assertBudget("a".repeat(100), 10)).toThrow(BudgetExceededError);
  });

  test("error includes tier name and counts", () => {
    try {
      assertBudget("a".repeat(100), 10, "tier1");
      expect(true).toBe(false); // should not reach
    } catch (e) {
      expect(e).toBeInstanceOf(BudgetExceededError);
      const err = e as BudgetExceededError;
      expect(err.tier).toBe("tier1");
      expect(err.actual).toBe(25);
      expect(err.budget).toBe(10);
    }
  });
});

describe("fitsInBudget", () => {
  test("returns true when text fits", () => {
    expect(fitsInBudget("hello", 10)).toBe(true);
  });

  test("returns false when text exceeds budget", () => {
    expect(fitsInBudget("a".repeat(100), 10)).toBe(false);
  });
});

describe("remainingBudget", () => {
  test("returns remaining capacity", () => {
    // 4 chars = 1 token, budget 10 → 9 remaining
    expect(remainingBudget("aaaa", 10)).toBe(9);
  });

  test("returns 0 when over budget (not negative)", () => {
    expect(remainingBudget("a".repeat(100), 10)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// minCacheableTokens — per-model minimum from API docs
// ---------------------------------------------------------------------------

describe("minCacheableTokens", () => {
  test("returns 4096 for claude-opus-4-6", () => {
    expect(minCacheableTokens("claude-opus-4-6")).toBe(4096);
  });

  test("returns 1024 for claude-sonnet-4-5-20250514", () => {
    expect(minCacheableTokens("claude-sonnet-4-5-20250514")).toBe(1024);
  });

  test("returns 4096 for claude-haiku-4-5-20251001", () => {
    expect(minCacheableTokens("claude-haiku-4-5-20251001")).toBe(4096);
  });

  test("returns default (4096) for unknown model", () => {
    expect(minCacheableTokens("some-future-model")).toBe(MIN_CACHEABLE_TOKENS_DEFAULT);
  });

  test("MIN_CACHEABLE_TOKENS has entries for all supported models", () => {
    expect(Object.keys(MIN_CACHEABLE_TOKENS).length).toBeGreaterThanOrEqual(8);
  });
});
