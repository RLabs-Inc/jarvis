// ---------------------------------------------------------------------------
// Context System Type Definitions
// ---------------------------------------------------------------------------
//
// Types for the tiered context system — the core innovation. These define
// how tier content is read, validated, and assembled into API requests.
// ---------------------------------------------------------------------------

import type { Message, SystemBlock } from "../api/types.ts";

// ---------------------------------------------------------------------------
// Tier Numbers
// ---------------------------------------------------------------------------

/** Tiers 1-3 are stored as files. Tier 4 is the live conversation. */
export type FileTierNum = 1 | 2 | 3;

/** All four tiers. */
export type TierNum = 1 | 2 | 3 | 4;

// ---------------------------------------------------------------------------
// Tier Content
// ---------------------------------------------------------------------------

/** Content read from a single tier directory. */
export interface TierContent {
  tier: FileTierNum;
  /** The concatenated text of all files in this tier. */
  text: string;
  /** Estimated token count. */
  tokens: number;
  /** Budget for this tier (from config). */
  budget: number;
  /** Files that were read to produce this content. */
  files: string[];
}

// ---------------------------------------------------------------------------
// Budget Validation
// ---------------------------------------------------------------------------

export type TierStatus = "ok" | "over_budget";

export interface TierBudgetEntry {
  tier: TierNum;
  tokens: number;
  budget: number;
  status: TierStatus;
  /** How many tokens over budget (0 if within). */
  overage: number;
}

export interface TierBudgetReport {
  tiers: TierBudgetEntry[];
  totalTokens: number;
  totalBudget: number;
  allWithinBudget: boolean;
}

// ---------------------------------------------------------------------------
// Context Assembly
// ---------------------------------------------------------------------------

/** The fully assembled context ready for an API call. */
export interface AssembledContext {
  /** System prompt blocks with cache breakpoints between tiers. */
  system: SystemBlock[];
  /** Tier 4 — the live conversation messages. */
  messages: Message[];
  /** Token report for each tier. */
  budget: TierBudgetReport;
  /** Tiers that need curator attention (over budget or flagged). */
  warnings: ContextWarning[];
}

export interface ContextWarning {
  tier: TierNum;
  type: "over_budget" | "tier4_truncated" | "below_cache_minimum";
  message: string;
}
