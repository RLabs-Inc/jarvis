// ---------------------------------------------------------------------------
// Tier File Management
// ---------------------------------------------------------------------------
//
// Reads, writes, and validates the tier directories (mind/tier1, tier2, tier3).
// Each tier is a directory of markdown files that get concatenated into a
// single text block for the API system prompt. Files are sorted alphabetically
// for deterministic ordering.
// ---------------------------------------------------------------------------

import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { countTokens } from "./tokens.ts";
import type { JarvisConfig } from "../config.ts";
import type {
  FileTierNum,
  TierContent,
  TierBudgetReport,
  TierBudgetEntry,
} from "./types.ts";

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/**
 * Read and concatenate all markdown files in a tier directory.
 * Files are sorted alphabetically for deterministic output.
 * Returns empty string if the directory is empty or doesn't exist.
 */
export async function readTier(
  mindDir: string,
  tierNum: FileTierNum,
): Promise<TierContent> {
  const tierDir = join(mindDir, `tier${tierNum}`);
  const files = await readTierFiles(tierDir);

  if (files.length === 0) {
    return { tier: tierNum, text: "", tokens: 0, budget: 0, files: [] };
  }

  const contents: string[] = [];
  for (const file of files) {
    const content = await readFile(join(tierDir, file), "utf-8");
    contents.push(content);
  }

  // Join with double newline separator between files
  const text = contents.join("\n\n");
  const tokens = countTokens(text);

  return { tier: tierNum, text, tokens, budget: 0, files };
}

/**
 * List markdown files in a tier directory, sorted alphabetically.
 */
async function readTierFiles(tierDir: string): Promise<string[]> {
  try {
    const entries = await readdir(tierDir);
    return entries
      .filter((f) => f.endsWith(".md"))
      .sort();
  } catch {
    // Directory doesn't exist — return empty
    return [];
  }
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

/**
 * Write a file to a tier directory.
 * Only Tier 2 and 3 are writable (Tier 1 is manually curated).
 * Creates the directory if it doesn't exist.
 */
export async function writeTier(
  mindDir: string,
  tierNum: 2 | 3,
  filename: string,
  content: string,
): Promise<void> {
  const tierDir = join(mindDir, `tier${tierNum}`);
  await mkdir(tierDir, { recursive: true });
  await writeFile(join(tierDir, filename), content, "utf-8");
}

// ---------------------------------------------------------------------------
// Token Counting
// ---------------------------------------------------------------------------

/**
 * Count total tokens across all files in a tier directory.
 */
export async function tierTokenCount(
  mindDir: string,
  tierNum: FileTierNum,
): Promise<number> {
  const tier = await readTier(mindDir, tierNum);
  return tier.tokens;
}

// ---------------------------------------------------------------------------
// Budget Validation
// ---------------------------------------------------------------------------

/**
 * Validate all tier budgets and return a comprehensive report.
 */
export async function validateTierBudgets(
  config: JarvisConfig,
): Promise<TierBudgetReport> {
  const tiers: TierBudgetEntry[] = [];

  // Read tiers 1-3 from files
  for (const tierNum of [1, 2, 3] as const) {
    const tier = await readTier(config.mindDir, tierNum);
    const budgetKey = `tier${tierNum}` as keyof typeof config.tierBudgets;
    const budget = config.tierBudgets[budgetKey];
    const overage = Math.max(0, tier.tokens - budget);

    tiers.push({
      tier: tierNum,
      tokens: tier.tokens,
      budget,
      status: overage > 0 ? "over_budget" : "ok",
      overage,
    });
  }

  // Tier 4 has no files to check — report budget only (tokens filled at assembly time)
  tiers.push({
    tier: 4,
    tokens: 0,
    budget: config.tierBudgets.tier4,
    status: "ok",
    overage: 0,
  });

  const totalTokens = tiers.reduce((sum, t) => sum + t.tokens, 0);
  const totalBudget = tiers.reduce((sum, t) => sum + t.budget, 0);
  const allWithinBudget = tiers.every((t) => t.status === "ok");

  return { tiers, totalTokens, totalBudget, allWithinBudget };
}
