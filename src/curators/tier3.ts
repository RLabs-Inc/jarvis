// ---------------------------------------------------------------------------
// Tier 3 Curator (Short-term Memory)
// ---------------------------------------------------------------------------
//
// Updates Tier 3 files after each session ends:
//   - recent.md — Session summaries (keeps last N)
//   - tasks.md  — Active tasks and todos
//   - context.md — Immediate context for next session
//
// Uses Haiku for speed and cost efficiency.
// Writes atomically with backup to protect existing state.
// ---------------------------------------------------------------------------

import { existsSync, writeFileSync, renameSync, mkdirSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { ClaudeClient } from "../api/client.ts";
import type { JarvisConfig } from "../config.ts";
import { loadTranscript } from "../session/transcript.ts";
import { formatTranscript, buildTier3Prompt, parseCuratorResponse } from "./prompts.ts";
import { readTierFile, extractText } from "./helpers.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default maximum number of recent sessions to keep in recent.md. */
const DEFAULT_MAX_RECENT_SESSIONS = 5;

/** Tier 3 files that the curator manages. */
const TIER3_FILES = ["recent.md", "tasks.md", "context.md"] as const;

// ---------------------------------------------------------------------------
// Atomic Write
// ---------------------------------------------------------------------------

/**
 * Write a file atomically with backup.
 *
 * 1. Write content to filename.tmp
 * 2. If original exists, copy to filename.bak
 * 3. Rename filename.tmp → filename (atomic on most filesystems)
 *
 * If any step fails, previous state is preserved.
 */
export function atomicWriteWithBackup(filePath: string, content: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const tmpPath = filePath + ".tmp";
  const bakPath = filePath + ".bak";

  // Step 1: Write to temp
  writeFileSync(tmpPath, content, "utf-8");

  // Step 2: Backup original if it exists
  if (existsSync(filePath)) {
    copyFileSync(filePath, bakPath);
  }

  // Step 3: Atomic rename
  renameSync(tmpPath, filePath);
}


// ---------------------------------------------------------------------------
// Tier 3 Curator
// ---------------------------------------------------------------------------

/**
 * Token usage from a curation API call.
 * Tracks cache fields per the API docs:
 *   total_input = cache_read + cache_creation + input
 */
export interface CuratorTokenUsage {
  input: number;
  output: number;
  cacheCreation: number;
  cacheRead: number;
}

export interface Tier3CurationResult {
  filesUpdated: string[];
  model: string;
  tokenUsage: CuratorTokenUsage;
}

/**
 * Run the Tier 3 curator for a completed session.
 *
 * 1. Load the session transcript
 * 2. Read current Tier 3 files
 * 3. Call Claude (Haiku) with the curation prompt
 * 4. Parse the response and write updated files atomically
 */
export async function curateTier3(
  config: JarvisConfig,
  client: ClaudeClient,
  sessionId: string,
  maxRecentSessions?: number,
): Promise<Tier3CurationResult> {
  const maxSessions = maxRecentSessions ?? DEFAULT_MAX_RECENT_SESSIONS;

  // Load the session transcript
  const messages = loadTranscript(config.mindDir, sessionId);
  if (messages.length === 0) {
    return { filesUpdated: [], model: config.curationModel, tokenUsage: { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 } };
  }

  // Format transcript for the curator prompt
  const transcript = formatTranscript(messages);

  // Read current Tier 3 content (via shared helper)
  const currentRecent = readTierFile(config.mindDir, 3, "recent.md");
  const currentTasks = readTierFile(config.mindDir, 3, "tasks.md");
  const currentContext = readTierFile(config.mindDir, 3, "context.md");

  // Build the curation prompt
  const prompt = buildTier3Prompt(transcript, currentRecent, currentTasks, currentContext, maxSessions);

  // Call Claude with the curation prompt
  const response = await client.call({
    model: config.curationModel,
    messages: [{ role: "user", content: prompt }],
    maxTokens: 4096,
  });

  // Extract text from response
  const responseText = extractText(response.content);

  // Parse the file updates
  const fileUpdates = parseCuratorResponse(responseText);

  // Write updated files atomically
  const filesUpdated: string[] = [];
  for (const filename of TIER3_FILES) {
    const content = fileUpdates.get(filename);
    if (content !== undefined) {
      const filePath = join(config.mindDir, "tier3", filename);
      atomicWriteWithBackup(filePath, content);
      filesUpdated.push(filename);
    }
  }

  return {
    filesUpdated,
    model: config.curationModel,
    tokenUsage: {
      input: response.usage.input_tokens,
      output: response.usage.output_tokens,
      cacheCreation: response.usage.cache_creation_input_tokens ?? 0,
      cacheRead: response.usage.cache_read_input_tokens ?? 0,
    },
  };
}

