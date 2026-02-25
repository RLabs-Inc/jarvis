// ---------------------------------------------------------------------------
// Tier 2 Curator (Medium-term Memory)
// ---------------------------------------------------------------------------
//
// Updates Tier 2 files after each session ends:
//   - projects.md — Active project states
//   - skills.md   — Skill inventory
//   - focus.md    — Current focus areas
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

import { join } from "node:path";
import { ClaudeClient } from "../api/client.ts";
import type { JarvisConfig } from "../config.ts";
import { loadTranscript } from "../session/transcript.ts";
import {
  splitTranscriptIntoChunks,
  buildChunkDigestPrompt,
  buildTier2Prompt,
  parseCuratorResponse,
} from "./prompts.ts";
import { atomicWriteWithBackup } from "./tier3.ts";
import type { CuratorTokenUsage } from "./tier3.ts";
import { readTierFile, extractText } from "./helpers.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Tier 2 files that the curator manages. */
const TIER2_FILES = ["projects.md", "skills.md", "focus.md"] as const;

// ---------------------------------------------------------------------------
// Tier 2 Curator
// ---------------------------------------------------------------------------

export interface Tier2CurationResult {
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
 * Run the Tier 2 curator for a completed session.
 *
 * For short sessions: single API call with full transcript.
 * For long sessions: chunk → digest → synthesize pipeline.
 */
export async function curateTier2(
  config: JarvisConfig,
  client: ClaudeClient,
  sessionId: string,
): Promise<Tier2CurationResult> {
  const model = config.curationModel;
  const tokenUsage: CuratorTokenUsage = { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 };

  // Load the session transcript
  const messages = loadTranscript(config.mindDir, sessionId);
  if (messages.length === 0) {
    return { filesUpdated: [], model, tokenUsage, chunks: 0 };
  }

  // Split transcript into chunks
  const chunks = splitTranscriptIntoChunks(messages);

  // Read current Tier 2 content
  const currentProjects = readTierFile(config.mindDir, 2, "projects.md");
  const currentSkills = readTierFile(config.mindDir, 2, "skills.md");
  const currentFocus = readTierFile(config.mindDir, 2, "focus.md");

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
  const prompt = buildTier2Prompt(
    transcriptOrNotes,
    currentProjects,
    currentSkills,
    currentFocus,
    isFromNotes,
  );

  const response = await client.call({
    model,
    messages: [{ role: "user", content: prompt }],
    maxTokens: 8192,
  });
  addUsage(tokenUsage, response);

  // Extract text from response
  const responseText = extractText(response.content);

  // Parse the file updates
  const fileUpdates = parseCuratorResponse(responseText);

  // Write updated files atomically
  const filesUpdated: string[] = [];
  for (const filename of TIER2_FILES) {
    const content = fileUpdates.get(filename);
    if (content !== undefined) {
      const filePath = join(config.mindDir, "tier2", filename);
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
