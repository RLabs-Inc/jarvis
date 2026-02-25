// ---------------------------------------------------------------------------
// Context Assembly Engine
// ---------------------------------------------------------------------------
//
// THE CORE INNOVATION. Before each API call, the assembler:
//
// 1. Reads all files in tier1/, tier2/, tier3/ → concatenated text blocks
// 2. Validates each tier against its token budget
// 3. Places cache breakpoints between tiers:
//    - Tier 1 content (no cache_control — cached with the next block)
//    - Tier 1 trailing block with cache_control { type: "ephemeral", ttl: "1h" }
//    - Tier 2 block with cache_control { type: "ephemeral", ttl: "1h" }
//    - Tier 3 block with cache_control { type: "ephemeral", ttl: "5m" }
// 4. Tier 4 messages pass through as-is (truncated if over budget)
// 5. Returns the assembled system[] + messages[] ready for the API
//
// Cache economics: Tier 1-2 cached for 1 hour (identity + projects rarely
// change). Tier 3 cached for 5 minutes (recent context changes often).
// Tier 4 never cached (live conversation). Cache hits cost 0.1x.
// ---------------------------------------------------------------------------

import { readTier } from "./tiers.ts";
import { countTokens, BudgetExceededError, minCacheableTokens } from "./tokens.ts";
import type { JarvisConfig } from "../config.ts";
import type { Message, SystemBlock } from "../api/types.ts";
import type {
  AssembledContext,
  ContextWarning,
  TierBudgetReport,
  TierBudgetEntry,
} from "./types.ts";

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

/**
 * Assemble the full tiered context for an API call.
 *
 * Reads tier files from disk, validates budgets, places cache breakpoints,
 * and returns the system prompt + messages ready for the Claude API.
 *
 * Overflow handling differs per tier:
 * - Tier 1: throws BudgetExceededError (must be manually trimmed)
 * - Tier 2: warns (flag for curator compression)
 * - Tier 3: warns (flag for curator to drop oldest)
 * - Tier 4: truncates oldest messages if over budget
 */
export async function assembleContext(
  config: JarvisConfig,
  messages: Message[],
): Promise<AssembledContext> {
  const warnings: ContextWarning[] = [];

  // Read tiers 1-3 from disk
  const tier1 = await readTier(config.mindDir, 1);
  const tier2 = await readTier(config.mindDir, 2);
  const tier3 = await readTier(config.mindDir, 3);

  // Fill in budgets from config
  tier1.budget = config.tierBudgets.tier1;
  tier2.budget = config.tierBudgets.tier2;
  tier3.budget = config.tierBudgets.tier3;

  // ---- Tier 1: error if over budget (core identity, must be trimmed manually)
  if (tier1.tokens > tier1.budget) {
    throw new BudgetExceededError("tier1", tier1.tokens, tier1.budget);
  }

  // ---- Tier 2: warn if over budget (curators should compress)
  if (tier2.tokens > tier2.budget) {
    warnings.push({
      tier: 2,
      type: "over_budget",
      message: `Tier 2 over budget: ${tier2.tokens} tokens > ${tier2.budget} budget. Curators should compress.`,
    });
  }

  // ---- Tier 3: warn if over budget (curators should drop oldest)
  if (tier3.tokens > tier3.budget) {
    warnings.push({
      tier: 3,
      type: "over_budget",
      message: `Tier 3 over budget: ${tier3.tokens} tokens > ${tier3.budget} budget. Curators should drop oldest entries.`,
    });
  }

  // ---- Tier 4: truncate oldest messages if over budget
  const tier4Budget = config.tierBudgets.tier4;
  const { truncated, tier4Tokens } = truncateMessages(messages, tier4Budget);
  if (truncated.length < messages.length) {
    warnings.push({
      tier: 4,
      type: "tier4_truncated",
      message: `Tier 4 truncated: ${messages.length - truncated.length} oldest messages dropped to fit ${tier4Budget} token budget.`,
    });
  }

  // ---- Build system prompt blocks with cache breakpoints
  const system = buildSystemBlocks(tier1.text, tier2.text, tier3.text);

  // ---- Check minimum cacheable token threshold (per API docs)
  // The API silently skips caching when the prefix at a breakpoint is below
  // the model's minimum. Warn so operators know caching may not be active.
  const systemTokens = tier1.tokens + tier2.tokens + tier3.tokens;
  const minTokens = minCacheableTokens(config.model);
  if (systemTokens > 0 && systemTokens < minTokens) {
    warnings.push({
      tier: 1,
      type: "below_cache_minimum",
      message: `System prompt total (${systemTokens} tokens) is below the minimum cacheable threshold (${minTokens} tokens for ${config.model}). Cache breakpoints will be ignored by the API.`,
    });
  }

  // ---- Build budget report
  const budget = buildBudgetReport(
    tier1, tier2, tier3, tier4Tokens, config.tierBudgets.tier4,
  );

  return { system, messages: truncated, budget, warnings };
}

// ---------------------------------------------------------------------------
// System Blocks — Cache Breakpoint Placement
// ---------------------------------------------------------------------------

/**
 * Build the system prompt array with cache breakpoints between tiers.
 *
 * Per the spec and Claude API docs:
 * - Tier 1: 1h TTL cache (identity, rarely changes)
 * - Tier 2: 1h TTL cache (projects, updated after curation)
 * - Tier 3: 5m TTL cache (recent context, changes frequently)
 *
 * Empty tiers are omitted entirely (no empty blocks in the API call).
 */
export function buildSystemBlocks(
  tier1Text: string,
  tier2Text: string,
  tier3Text: string,
): SystemBlock[] {
  const blocks: SystemBlock[] = [];

  if (tier1Text) {
    blocks.push({
      type: "text",
      text: tier1Text,
      cache_control: { type: "ephemeral", ttl: "1h" },
    });
  }

  if (tier2Text) {
    blocks.push({
      type: "text",
      text: tier2Text,
      cache_control: { type: "ephemeral", ttl: "1h" },
    });
  }

  if (tier3Text) {
    blocks.push({
      type: "text",
      text: tier3Text,
      cache_control: { type: "ephemeral", ttl: "5m" },
    });
  }

  return blocks;
}

// ---------------------------------------------------------------------------
// Message Truncation (Tier 4 overflow)
// ---------------------------------------------------------------------------

/**
 * Truncate oldest messages to fit within Tier 4's token budget.
 * Always keeps at least the last message (the user's current input).
 * Returns the truncated array and the token count.
 */
export function truncateMessages(
  messages: Message[],
  budget: number,
): { truncated: Message[]; tier4Tokens: number } {
  if (messages.length === 0) {
    return { truncated: [], tier4Tokens: 0 };
  }

  // Count tokens for all messages
  const totalTokens = countMessagesTokens(messages);

  if (totalTokens <= budget) {
    return { truncated: messages, tier4Tokens: totalTokens };
  }

  // Drop oldest messages until we fit, but always keep at least the last one.
  // Use an index pointer instead of repeated slice to stay O(n).
  let startIndex = 0;
  let tokens = totalTokens;

  while (tokens > budget && startIndex < messages.length - 1) {
    tokens -= countMessageTokens(messages[startIndex]!);
    startIndex++;
  }

  return { truncated: messages.slice(startIndex), tier4Tokens: tokens };
}

// ---------------------------------------------------------------------------
// Message Token Counting
// ---------------------------------------------------------------------------

function countMessageTokens(msg: Message): number {
  if (typeof msg.content === "string") {
    return countTokens(msg.content);
  }
  // Content block array — sum all text parts
  let tokens = 0;
  for (const block of msg.content) {
    if (block.type === "text") {
      tokens += countTokens(block.text);
    } else if (block.type === "tool_use") {
      tokens += countTokens(JSON.stringify(block.input));
      tokens += countTokens(block.name);
    } else if (block.type === "tool_result") {
      tokens += countTokens(block.content);
    }
  }
  return tokens;
}

function countMessagesTokens(messages: Message[]): number {
  let total = 0;
  for (const msg of messages) {
    total += countMessageTokens(msg);
  }
  return total;
}

// ---------------------------------------------------------------------------
// Budget Report Builder
// ---------------------------------------------------------------------------

function buildBudgetReport(
  tier1: { tokens: number; budget: number },
  tier2: { tokens: number; budget: number },
  tier3: { tokens: number; budget: number },
  tier4Tokens: number,
  tier4Budget: number,
): TierBudgetReport {
  const tiers: TierBudgetEntry[] = [
    {
      tier: 1,
      tokens: tier1.tokens,
      budget: tier1.budget,
      status: tier1.tokens > tier1.budget ? "over_budget" : "ok",
      overage: Math.max(0, tier1.tokens - tier1.budget),
    },
    {
      tier: 2,
      tokens: tier2.tokens,
      budget: tier2.budget,
      status: tier2.tokens > tier2.budget ? "over_budget" : "ok",
      overage: Math.max(0, tier2.tokens - tier2.budget),
    },
    {
      tier: 3,
      tokens: tier3.tokens,
      budget: tier3.budget,
      status: tier3.tokens > tier3.budget ? "over_budget" : "ok",
      overage: Math.max(0, tier3.tokens - tier3.budget),
    },
    {
      tier: 4,
      tokens: tier4Tokens,
      budget: tier4Budget,
      status: tier4Tokens > tier4Budget ? "over_budget" : "ok",
      overage: Math.max(0, tier4Tokens - tier4Budget),
    },
  ];

  const totalTokens = tiers.reduce((sum, t) => sum + t.tokens, 0);
  const totalBudget = tiers.reduce((sum, t) => sum + t.budget, 0);
  const allWithinBudget = tiers.every((t) => t.status === "ok");

  return { tiers, totalTokens, totalBudget, allWithinBudget };
}
