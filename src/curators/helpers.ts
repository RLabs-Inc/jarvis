// ---------------------------------------------------------------------------
// Shared Curator Helpers
// ---------------------------------------------------------------------------
//
// Utilities shared across tier curators. Extracted to avoid duplication
// between tier2.ts and tier3.ts.
// ---------------------------------------------------------------------------

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ContentBlock, TextBlock } from "../api/types.ts";

/**
 * Read a tier file's content. Returns empty string if missing.
 */
export function readTierFile(mindDir: string, tier: number, filename: string): string {
  const path = join(mindDir, `tier${tier}`, filename);
  if (!existsSync(path)) return "";
  return readFileSync(path, "utf-8");
}

/**
 * Extract text content from a ContentBlock array.
 * Ignores tool_use and tool_result blocks — only extracts text.
 */
export function extractText(content: ContentBlock[]): string {
  return content
    .filter((block): block is TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");
}
