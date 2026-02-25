// ---------------------------------------------------------------------------
// Crontab Self-Management
// ---------------------------------------------------------------------------
//
// Jarvis manages its own crontab entries. Each entry is tagged with
// a comment `# jarvis:<id>` for reliable identification and removal.
//
// Uses the native `crontab` command — no npm dependencies.
// Jarvis entries are isolated from system crontab entries.
// ---------------------------------------------------------------------------

import { execBash } from "./bash.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CronEntry {
  id: string;
  schedule: string;
  command: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const JARVIS_TAG = "# jarvis:";

// ---------------------------------------------------------------------------
// Parse / Serialize
// ---------------------------------------------------------------------------

/**
 * Parse a crontab string into Jarvis entries and other lines.
 * Jarvis entries are identified by the `# jarvis:<id>` tag at end of line.
 */
export function parseCrontab(raw: string): { jarvis: CronEntry[]; other: string[] } {
  const jarvis: CronEntry[] = [];
  const other: string[] = [];

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      if (trimmed) other.push(line);
      continue;
    }

    const tagIdx = line.indexOf(JARVIS_TAG);
    if (tagIdx === -1) {
      other.push(line);
      continue;
    }

    const id = line.slice(tagIdx + JARVIS_TAG.length).trim();
    const beforeTag = line.slice(0, tagIdx).trim();

    // Cron format: min hour dom month dow command
    // First 5 fields are the schedule, rest is the command
    const parts = beforeTag.split(/\s+/);
    if (parts.length < 6) {
      other.push(line);
      continue;
    }

    const schedule = parts.slice(0, 5).join(" ");
    const command = parts.slice(5).join(" ");
    jarvis.push({ id, schedule, command });
  }

  return { jarvis, other };
}

/**
 * Serialize Jarvis entries and other lines back to a crontab string.
 */
export function serializeCrontab(jarvis: CronEntry[], other: string[]): string {
  const lines = [...other];

  for (const entry of jarvis) {
    lines.push(`${entry.schedule} ${entry.command} ${JARVIS_TAG}${entry.id}`);
  }

  // Crontab must end with a newline
  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Crontab Operations
// ---------------------------------------------------------------------------

/**
 * List all Jarvis-managed cron entries.
 */
export async function cronList(): Promise<CronEntry[]> {
  const result = await execBash("crontab -l 2>/dev/null || true");
  const { jarvis } = parseCrontab(result.stdout);
  return jarvis;
}

/**
 * Add a new Jarvis cron entry.
 * If an entry with the same ID exists, it is replaced.
 */
export async function cronAdd(entry: CronEntry): Promise<void> {
  const result = await execBash("crontab -l 2>/dev/null || true");
  const { jarvis, other } = parseCrontab(result.stdout);

  // Replace existing entry with same ID, or add new
  const filtered = jarvis.filter((e) => e.id !== entry.id);
  filtered.push(entry);

  const newCrontab = serializeCrontab(filtered, other);
  await execBash("crontab -", { stdin_text: newCrontab });
}

/**
 * Remove a Jarvis cron entry by ID.
 */
export async function cronRemove(id: string): Promise<void> {
  const result = await execBash("crontab -l 2>/dev/null || true");
  const { jarvis, other } = parseCrontab(result.stdout);

  const filtered = jarvis.filter((e) => e.id !== id);
  const newCrontab = serializeCrontab(filtered, other);
  await execBash("crontab -", { stdin_text: newCrontab });
}
