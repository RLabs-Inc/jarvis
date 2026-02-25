// ---------------------------------------------------------------------------
// Crontab Self-Management (Heartbeat Layer)
// ---------------------------------------------------------------------------
//
// Higher-level cron management built on top of src/tools/cron.ts.
// Manages the default Jarvis schedule and provides schedule-level operations.
//
// The spec's crontab:
//   0 7 * * *     morning_routine     — Check notifications, prepare context
//   0 */6 * * *   check_rate_limits   — Monitor Max subscription usage
//   0 2 * * 0     weekly_review       — Consolidate memories, clean archive
//
// Each cron job invokes: <daemonPath> wake --task <name>
// ---------------------------------------------------------------------------

import { cronList, cronAdd, cronRemove, parseCrontab, serializeCrontab } from "../tools/cron.ts";
import type { CronEntry } from "../tools/cron.ts";
import { execBash } from "../tools/bash.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScheduleEntry {
  id: string;
  schedule: string;
  task: string;
}

// ---------------------------------------------------------------------------
// Default Schedule
// ---------------------------------------------------------------------------

/**
 * Build the default Jarvis schedule.
 */
export function buildDefaultSchedule(): ScheduleEntry[] {
  return [
    {
      id: "morning_routine",
      schedule: "0 7 * * *",
      task: "morning_routine",
    },
    {
      id: "check_rate_limits",
      schedule: "0 */6 * * *",
      task: "check_rate_limits",
    },
    {
      id: "weekly_review",
      schedule: "0 2 * * 0",
      task: "weekly_review",
    },
  ];
}

/**
 * Convert a ScheduleEntry to a CronEntry for the low-level cron API.
 */
function toCronEntry(entry: ScheduleEntry, daemonPath: string): CronEntry {
  return {
    id: entry.id,
    schedule: entry.schedule,
    command: `${daemonPath} wake --task ${entry.task}`,
  };
}

/**
 * Extract the task name from a cron command string.
 * Parses: "/path/to/daemon wake --task morning_routine" → "morning_routine"
 */
export function extractTaskName(command: string): string | null {
  const match = command.match(/wake\s+--task\s+(\S+)/);
  return match ? match[1]! : null;
}

// ---------------------------------------------------------------------------
// Schedule Operations
// ---------------------------------------------------------------------------

/**
 * Install the default Jarvis cron schedule.
 * Replaces any existing Jarvis entries with the defaults.
 */
export async function installDefaultSchedule(daemonPath: string): Promise<void> {
  const defaults = buildDefaultSchedule();

  for (const entry of defaults) {
    await cronAdd(toCronEntry(entry, daemonPath));
  }
}

/**
 * Get the current Jarvis schedule as ScheduleEntries.
 */
export async function getSchedule(): Promise<ScheduleEntry[]> {
  const entries = await cronList();
  return entries.map((e) => ({
    id: e.id,
    schedule: e.schedule,
    task: extractTaskName(e.command) ?? e.id,
  }));
}

/**
 * Replace the entire Jarvis schedule with new entries.
 * Removes all existing Jarvis cron entries and installs the new ones.
 */
export async function updateSchedule(
  entries: ScheduleEntry[],
  daemonPath: string,
): Promise<void> {
  // Read current crontab
  const result = await execBash("crontab -l 2>/dev/null || true");
  const { other } = parseCrontab(result.stdout);

  // Build new cron entries from schedule entries
  const cronEntries = entries.map((e) => toCronEntry(e, daemonPath));

  // Serialize: keep system entries, replace all Jarvis entries
  const newCrontab = serializeCrontab(cronEntries, other);
  await execBash("crontab -", { stdin_text: newCrontab });
}

/**
 * Remove a single task from the schedule by its ID.
 */
export async function removeScheduleEntry(id: string): Promise<void> {
  await cronRemove(id);
}

// Re-export CronEntry for convenience
export type { CronEntry };
