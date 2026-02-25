// ---------------------------------------------------------------------------
// Rate Limit Tracking
// ---------------------------------------------------------------------------
//
// Jarvis tracks Max subscription usage to make intelligent decisions about
// when to run autonomous tasks and which model to use.
//
// Before each API call (especially cron-triggered ones), the heartbeat
// checks utilization. If approaching limits:
//   - Defer non-urgent cron tasks
//   - Downgrade model (opus → sonnet → haiku)
//   - Log a warning for Sherlock
//
// Usage history is persisted for pattern awareness over time.
// ---------------------------------------------------------------------------

import type { JarvisConfig } from "../config.ts";
import type { UsageInfo } from "../api/types.ts";
import { checkUsage } from "../api/auth.ts";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RateLimitStatus {
  /** 5-hour window utilization (0.0 - 1.0) */
  fiveHour: number;
  /** 7-day window utilization (0.0 - 1.0) */
  sevenDay: number;
  /** When the 5-hour window resets (ISO string) */
  fiveHourResetsAt: string;
  /** When the 7-day window resets (ISO string) */
  sevenDayResetsAt: string;
  /** Timestamp of this check */
  checkedAt: string;
}

export interface UsageHistoryEntry {
  fiveHour: number;
  sevenDay: number;
  checkedAt: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default utilization threshold above which we start throttling. */
const DEFAULT_THROTTLE_THRESHOLD = 0.8;

/** Maximum usage history entries to keep. */
const MAX_HISTORY_ENTRIES = 100;

/** Model downgrade chain: prefer → fallback1 → fallback2 */
const MODEL_TIERS: Record<string, string[]> = {
  "claude-opus-4-6": ["claude-sonnet-4-6", "claude-haiku-4-5-20251001"],
  "claude-sonnet-4-6": ["claude-haiku-4-5-20251001"],
  "claude-haiku-4-5-20251001": [],
};

// ---------------------------------------------------------------------------
// Core Functions
// ---------------------------------------------------------------------------

/**
 * Check current rate limit status by querying the API.
 * Returns a normalized RateLimitStatus.
 */
export async function checkLimits(config: JarvisConfig): Promise<RateLimitStatus> {
  const usage: UsageInfo = await checkUsage(config);
  return fromUsageInfo(usage);
}

/**
 * Convert raw API UsageInfo to our normalized RateLimitStatus.
 */
export function fromUsageInfo(usage: UsageInfo): RateLimitStatus {
  return {
    fiveHour: usage.five_hour.utilization,
    sevenDay: usage.seven_day.utilization,
    fiveHourResetsAt: usage.five_hour.resets_at,
    sevenDayResetsAt: usage.seven_day.resets_at,
    checkedAt: new Date().toISOString(),
  };
}

/**
 * Determine if we should throttle (defer non-urgent work).
 * Returns true if either window exceeds the threshold.
 */
export function shouldThrottle(
  status: RateLimitStatus,
  threshold: number = DEFAULT_THROTTLE_THRESHOLD,
): boolean {
  return status.fiveHour >= threshold || status.sevenDay >= threshold;
}

/**
 * Select the best model given current utilization.
 *
 * - Below 50%: use preferred model
 * - 50-80%: downgrade one tier
 * - Above 80%: downgrade to cheapest
 *
 * Returns the preferred model unchanged if it has no downgrade chain.
 */
export function selectModel(
  status: RateLimitStatus,
  preferred: string,
): string {
  const maxUtil = Math.max(status.fiveHour, status.sevenDay);
  const downgrades = MODEL_TIERS[preferred];

  // Unknown model or no downgrades available — use as-is
  if (!downgrades || downgrades.length === 0) {
    return preferred;
  }

  if (maxUtil >= 0.8) {
    // Use cheapest available
    return downgrades[downgrades.length - 1]!;
  }

  if (maxUtil >= 0.5) {
    // Downgrade one tier
    return downgrades[0]!;
  }

  return preferred;
}

// ---------------------------------------------------------------------------
// Usage History Persistence
// ---------------------------------------------------------------------------

function historyPath(mindDir: string): string {
  return join(mindDir, "heartbeat", "usage-history.json");
}

/**
 * Load usage history from disk.
 */
export function loadUsageHistory(mindDir: string): UsageHistoryEntry[] {
  const path = historyPath(mindDir);
  if (!existsSync(path)) return [];

  try {
    const raw = readFileSync(path, "utf-8");
    return JSON.parse(raw) as UsageHistoryEntry[];
  } catch {
    return [];
  }
}

/**
 * Record a rate limit check to the usage history.
 * Keeps at most MAX_HISTORY_ENTRIES, dropping oldest.
 */
export function recordUsage(mindDir: string, status: RateLimitStatus): void {
  const path = historyPath(mindDir);
  const dir = dirname(path);

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const history = loadUsageHistory(mindDir);
  history.push({
    fiveHour: status.fiveHour,
    sevenDay: status.sevenDay,
    checkedAt: status.checkedAt,
  });

  // Keep only the most recent entries
  const trimmed = history.slice(-MAX_HISTORY_ENTRIES);
  writeFileSync(path, JSON.stringify(trimmed, null, 2));
}

// ---------------------------------------------------------------------------
// Exported constants for testing
// ---------------------------------------------------------------------------

export { DEFAULT_THROTTLE_THRESHOLD, MAX_HISTORY_ENTRIES, MODEL_TIERS };
