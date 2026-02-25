// ---------------------------------------------------------------------------
// Tier 3 Curator (Short-term Memory)
// ---------------------------------------------------------------------------
//
// Updates Tier 3 files after each session ends:
//   - recent.md — Session summaries (keeps last N)
//   - tasks.md  — Active tasks and todos
//   - context.md — Immediate context for next session
//
// Uses the same model as the vessel itself (Opus) — these are my memories,
// I should curate them myself. No delegation to smaller models.
//
// For long sessions, the transcript is processed in chunks:
//   1. Each chunk → running notes (accumulating understanding)
//   2. Final pass: notes + current files → updated memory files
//
// Writes atomically with backup to protect existing state.
// ---------------------------------------------------------------------------

import { existsSync, writeFileSync, renameSync, mkdirSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { ClaudeClient } from "../api/client.ts";
import type { JarvisConfig } from "../config.ts";
import { loadTranscript } from "../session/transcript.ts";
import {
  splitTranscriptIntoChunks,
  buildChunkDigestPrompt,
  buildTier3Prompt,
  parseCuratorResponse,
} from "./prompts.ts";
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
  chunks: number;
}

/**
 * Accumulate token usage from a response.
 */
function addUsage(
  total: CuratorTokenUsage,
  response: { usage: { input_tokens: number; output_tokens: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number } },
): void {
  total.input += response.usage.input_tokens;
  total.output += response.usage.output_tokens;
  total.cacheCreation += response.usage.cache_creation_input_tokens ?? 0;
  total.cacheRead += response.usage.cache_read_input_tokens ?? 0;
}

/**
 * Run the Tier 3 curator for a completed session.
 *
 * For short sessions: single API call with full transcript.
 * For long sessions: chunk → digest → synthesize pipeline.
 */
export async function curateTier3(
  config: JarvisConfig,
  client: ClaudeClient,
  sessionId: string,
  maxRecentSessions?: number,
): Promise<Tier3CurationResult> {
  const maxSessions = maxRecentSessions ?? DEFAULT_MAX_RECENT_SESSIONS;
  const model = config.curationModel;
  const tokenUsage: CuratorTokenUsage = { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 };

  // Load the session transcript
  const messages = loadTranscript(config.mindDir, sessionId);
  if (messages.length === 0) {
    return { filesUpdated: [], model, tokenUsage, chunks: 0 };
  }

  // Split transcript into chunks
  const chunks = splitTranscriptIntoChunks(messages);

  // Read current Tier 3 content
  const currentRecent = readTierFile(config.mindDir, 3, "recent.md");
  const currentTasks = readTierFile(config.mindDir, 3, "tasks.md");
  const currentContext = readTierFile(config.mindDir, 3, "context.md");

  let transcriptOrNotes: string;
  let isFromNotes = false;

  if (chunks.length <= 1) {
    // Short session — use transcript directly
    transcriptOrNotes = chunks[0] ?? "";
  } else {
    // Long session — process chunks into running notes
    let runningNotes = "";
    for (let i = 0; i < chunks.length; i++) {
      const prompt = buildChunkDigestPrompt(chunks[i]!, i, chunks.length, runningNotes);
      const response = await client.call({
        model,
        messages: [{ role: "user", content: prompt }],
        maxTokens: 4096,
      });
      addUsage(tokenUsage, response);
      runningNotes = extractText(response.content);
    }
    transcriptOrNotes = runningNotes;
    isFromNotes = true;
  }

  // Final pass: build memory files from transcript or notes
  const prompt = buildTier3Prompt(
    transcriptOrNotes,
    currentRecent,
    currentTasks,
    currentContext,
    maxSessions,
    isFromNotes,
  );

  const response = await client.call({
    model,
    messages: [{ role: "user", content: prompt }],
    maxTokens: 4096,
  });
  addUsage(tokenUsage, response);

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
    model,
    tokenUsage,
    chunks: chunks.length,
  };
}
