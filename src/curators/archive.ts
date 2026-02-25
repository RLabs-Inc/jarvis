// ---------------------------------------------------------------------------
// Archive Curator
// ---------------------------------------------------------------------------
//
// Handles post-session transcript archival. The SessionManager already moves
// the transcript from active/ to archive/ — this curator enriches the archive
// with metadata (session summary, duration, message count) stored as a
// companion JSON file alongside the transcript.
//
// The metadata file enables future search and review without parsing JSONL.
// ---------------------------------------------------------------------------

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { archiveTranscriptPath } from "../session/transcript.ts";
import type { SessionEndEvent } from "../session/manager.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ArchiveMetadata {
  sessionId: string;
  endedAt: string;
  reason: string;
  messageCount: number;
  durationMs: number;
  transcriptPath: string;
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

export function metadataPath(mindDir: string, sessionId: string): string {
  return join(mindDir, "conversations", "archive", `${sessionId}.meta.json`);
}

// ---------------------------------------------------------------------------
// Archive Curator
// ---------------------------------------------------------------------------

/**
 * Write archive metadata for a completed session.
 * Creates a companion .meta.json file next to the archived transcript.
 *
 * This is lightweight and synchronous — no API calls needed.
 */
export function archiveWithMetadata(
  mindDir: string,
  event: SessionEndEvent,
): ArchiveMetadata {
  const transcriptFile = archiveTranscriptPath(mindDir, event.sessionId);
  const metaFile = metadataPath(mindDir, event.sessionId);

  const metaDir = dirname(metaFile);
  if (!existsSync(metaDir)) {
    mkdirSync(metaDir, { recursive: true });
  }

  const metadata: ArchiveMetadata = {
    sessionId: event.sessionId,
    endedAt: new Date().toISOString(),
    reason: event.reason,
    messageCount: event.messageCount,
    durationMs: event.durationMs,
    transcriptPath: transcriptFile,
  };

  writeFileSync(metaFile, JSON.stringify(metadata, null, 2) + "\n", "utf-8");

  return metadata;
}

/**
 * Load archive metadata for a session.
 * Returns null if the metadata file doesn't exist.
 */
export function loadArchiveMetadata(
  mindDir: string,
  sessionId: string,
): ArchiveMetadata | null {
  const path = metadataPath(mindDir, sessionId);
  if (!existsSync(path)) return null;

  try {
    return JSON.parse(readFileSync(path, "utf-8")) as ArchiveMetadata;
  } catch {
    return null;
  }
}

/**
 * List all archived session IDs by scanning for .meta.json files.
 */
export function listArchivedSessions(mindDir: string): string[] {
  const archiveDir = join(mindDir, "conversations", "archive");
  if (!existsSync(archiveDir)) return [];

  try {
    return readdirSync(archiveDir)
      .filter((f) => f.endsWith(".meta.json"))
      .map((f) => f.replace(".meta.json", ""))
      .sort();
  } catch {
    return [];
  }
}
