// ---------------------------------------------------------------------------
// Curation Orchestrator
// ---------------------------------------------------------------------------
//
// Coordinates the post-interaction curation cycle. After each session ends,
// the orchestrator runs all three curators:
//
//   1. Tier 3 (Haiku) — Short-term memory update
//   2. Tier 2 (Sonnet) — Medium-term memory update
//   3. Archive — Transcript metadata storage
//
// Tier 2 and Tier 3 curators run in parallel (independent).
// Archive runs alongside them (no API calls, just file I/O).
// Failures are logged but don't block other curators.
//
// The orchestrator is fire-and-forget from the daemon's perspective:
// the daemon triggers curation and doesn't wait for completion.
// ---------------------------------------------------------------------------

import type { JarvisConfig } from "../config.ts";
import type { SessionEndEvent } from "../session/manager.ts";
import { ClaudeClient } from "../api/client.ts";
import { curateTier2 } from "./tier2.ts";
import type { Tier2CurationResult } from "./tier2.ts";
import { curateTier3 } from "./tier3.ts";
import type { Tier3CurationResult } from "./tier3.ts";
import { archiveWithMetadata } from "./archive.ts";
import type { ArchiveMetadata } from "./archive.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CurationResult {
  sessionId: string;
  tier2: Tier2CurationResult | null;
  tier3: Tier3CurationResult | null;
  archive: ArchiveMetadata | null;
  errors: CurationError[];
  durationMs: number;
}

export interface CurationError {
  curator: "tier2" | "tier3" | "archive";
  error: string;
}

/** Callback for curation progress/completion. */
export type CurationCallback = (result: CurationResult) => void;

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

/**
 * Run the full post-interaction curation cycle.
 *
 * All three curators run in parallel. Failures in individual curators
 * are captured in the result's errors array — one curator failing
 * doesn't prevent others from running.
 */
export async function runCuration(
  config: JarvisConfig,
  event: SessionEndEvent,
  onComplete?: CurationCallback,
): Promise<CurationResult> {
  const startTime = Date.now();
  const client = new ClaudeClient(config);

  const errors: CurationError[] = [];
  let tier2Result: Tier2CurationResult | null = null;
  let tier3Result: Tier3CurationResult | null = null;
  let archiveResult: ArchiveMetadata | null = null;

  // Run all three curators in parallel
  const [tier2Outcome, tier3Outcome, archiveOutcome] = await Promise.allSettled([
    curateTier2(config, client, event.sessionId),
    curateTier3(config, client, event.sessionId),
    Promise.resolve().then(() => archiveWithMetadata(config.mindDir, event)),
  ]);

  // Collect results
  if (tier2Outcome.status === "fulfilled") {
    tier2Result = tier2Outcome.value;
  } else {
    errors.push({ curator: "tier2", error: String(tier2Outcome.reason) });
  }

  if (tier3Outcome.status === "fulfilled") {
    tier3Result = tier3Outcome.value;
  } else {
    errors.push({ curator: "tier3", error: String(tier3Outcome.reason) });
  }

  if (archiveOutcome.status === "fulfilled") {
    archiveResult = archiveOutcome.value;
  } else {
    errors.push({ curator: "archive", error: String(archiveOutcome.reason) });
  }

  const result: CurationResult = {
    sessionId: event.sessionId,
    tier2: tier2Result,
    tier3: tier3Result,
    archive: archiveResult,
    errors,
    durationMs: Date.now() - startTime,
  };

  onComplete?.(result);

  return result;
}

/**
 * Fire-and-forget curation. Runs in the background — errors are logged
 * but don't propagate. This is how the daemon triggers curation.
 */
export function triggerCuration(
  config: JarvisConfig,
  event: SessionEndEvent,
  onComplete?: CurationCallback,
  onError?: (error: unknown) => void,
): void {
  runCuration(config, event, onComplete).catch((err) => {
    onError?.(err);
  });
}
