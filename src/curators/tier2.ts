// ---------------------------------------------------------------------------
// Tier 2 Curator (Medium-term Memory)
// ---------------------------------------------------------------------------
//
// Updates Tier 2 files after each session ends:
//   - projects.md — Active project states
//   - skills.md   — Skill inventory
//   - focus.md    — Current focus areas
//
// Uses Sonnet for higher quality reasoning about project/skill updates.
// Writes atomically with backup to protect existing state.
// ---------------------------------------------------------------------------

import { join } from "node:path";
import { ClaudeClient } from "../api/client.ts";
import type { JarvisConfig } from "../config.ts";
import { loadTranscript } from "../session/transcript.ts";
import { formatTranscript, buildTier2Prompt, parseCuratorResponse } from "./prompts.ts";
import { atomicWriteWithBackup } from "./tier3.ts";
import type { CuratorTokenUsage } from "./tier3.ts";
import { readTierFile, extractText } from "./helpers.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Tier 2 model — uses Sonnet for better reasoning about projects/skills. */
const TIER2_MODEL = "claude-sonnet-4-6";

/** Tier 2 files that the curator manages. */
const TIER2_FILES = ["projects.md", "skills.md", "focus.md"] as const;

// ---------------------------------------------------------------------------
// Tier 2 Curator
// ---------------------------------------------------------------------------

export interface Tier2CurationResult {
  filesUpdated: string[];
  model: string;
  tokenUsage: CuratorTokenUsage;
}

/**
 * Run the Tier 2 curator for a completed session.
 *
 * 1. Load the session transcript
 * 2. Read current Tier 2 files
 * 3. Call Claude (Sonnet) with the curation prompt
 * 4. Parse the response and write updated files atomically
 */
export async function curateTier2(
  config: JarvisConfig,
  client: ClaudeClient,
  sessionId: string,
): Promise<Tier2CurationResult> {
  // Load the session transcript
  const messages = loadTranscript(config.mindDir, sessionId);
  if (messages.length === 0) {
    return { filesUpdated: [], model: TIER2_MODEL, tokenUsage: { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 } };
  }

  // Format transcript for the curator prompt
  const transcript = formatTranscript(messages);

  // Read current Tier 2 content
  const currentProjects = readTierFile(config.mindDir, 2, "projects.md");
  const currentSkills = readTierFile(config.mindDir, 2, "skills.md");
  const currentFocus = readTierFile(config.mindDir, 2, "focus.md");

  // Build the curation prompt
  const prompt = buildTier2Prompt(transcript, currentProjects, currentSkills, currentFocus);

  // Call Claude with the curation prompt (Sonnet for quality)
  const response = await client.call({
    model: TIER2_MODEL,
    messages: [{ role: "user", content: prompt }],
    maxTokens: 8192,
  });

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
    model: TIER2_MODEL,
    tokenUsage: {
      input: response.usage.input_tokens,
      output: response.usage.output_tokens,
      cacheCreation: response.usage.cache_creation_input_tokens ?? 0,
      cacheRead: response.usage.cache_read_input_tokens ?? 0,
    },
  };
}

