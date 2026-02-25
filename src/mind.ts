import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Mind Directory Management
// ---------------------------------------------------------------------------

/** Required subdirectories within the mind directory. */
const MIND_SUBDIRS = [
  "tier1",
  "tier2",
  "tier3",
  "conversations/active",
  "conversations/archive",
  "workshop/tools",
] as const;

export type MindSubdir = (typeof MIND_SUBDIRS)[number];

/**
 * Validate that all required mind subdirectories exist.
 * Returns missing directories (empty array = all present).
 */
export function validateMindDir(mindDir: string): string[] {
  const missing: string[] = [];
  for (const sub of MIND_SUBDIRS) {
    const full = join(mindDir, sub);
    if (!existsSync(full)) {
      missing.push(sub);
    }
  }
  return missing;
}

/**
 * Ensure all required mind subdirectories exist, creating any that are missing.
 */
export function ensureMindDir(mindDir: string): void {
  for (const sub of MIND_SUBDIRS) {
    const full = join(mindDir, sub);
    if (!existsSync(full)) {
      mkdirSync(full, { recursive: true });
    }
  }
}

export { MIND_SUBDIRS };
