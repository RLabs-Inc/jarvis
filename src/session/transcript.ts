// ---------------------------------------------------------------------------
// Transcript Storage
// ---------------------------------------------------------------------------
//
// Stores session transcripts in JSON Lines format — one message per line.
// Each line is a self-contained JSON object with the message and metadata.
//
// Active transcripts live in mind/conversations/active/<sessionId>.jsonl
// Archived transcripts move to mind/conversations/archive/<sessionId>.jsonl
//
// JSONL chosen because:
// - Append-only (crash-safe — no need to rewrite the whole file)
// - Streamable (can read line by line for large transcripts)
// - Human-readable with `cat` or `jq`
// ---------------------------------------------------------------------------

import { readFileSync, appendFileSync, existsSync, mkdirSync, renameSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import type { Message } from "../api/types.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TranscriptEntry {
  timestamp: string;
  message: Message;
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

export function activeTranscriptPath(mindDir: string, sessionId: string): string {
  return join(mindDir, "conversations", "active", `${sessionId}.jsonl`);
}

export function archiveTranscriptPath(mindDir: string, sessionId: string): string {
  return join(mindDir, "conversations", "archive", `${sessionId}.jsonl`);
}

// ---------------------------------------------------------------------------
// Append
// ---------------------------------------------------------------------------

/**
 * Append a message to the active session transcript.
 * Creates the file and parent directories if they don't exist.
 */
export function appendMessage(mindDir: string, sessionId: string, message: Message): void {
  const path = activeTranscriptPath(mindDir, sessionId);
  const dir = dirname(path);

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const entry: TranscriptEntry = {
    timestamp: new Date().toISOString(),
    message,
  };

  appendFileSync(path, JSON.stringify(entry) + "\n", "utf-8");
}

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

/**
 * Load all messages from a session transcript (active or archived).
 * Returns an empty array if the transcript doesn't exist.
 */
export function loadTranscript(mindDir: string, sessionId: string): Message[] {
  // Try active first, then archive
  let path = activeTranscriptPath(mindDir, sessionId);
  if (!existsSync(path)) {
    path = archiveTranscriptPath(mindDir, sessionId);
  }
  if (!existsSync(path)) {
    return [];
  }

  return parseTranscriptFile(path);
}

/**
 * Load transcript entries with full metadata (timestamps).
 */
export function loadTranscriptEntries(mindDir: string, sessionId: string): TranscriptEntry[] {
  let path = activeTranscriptPath(mindDir, sessionId);
  if (!existsSync(path)) {
    path = archiveTranscriptPath(mindDir, sessionId);
  }
  if (!existsSync(path)) {
    return [];
  }

  return parseTranscriptEntriesFile(path);
}

// ---------------------------------------------------------------------------
// Archive
// ---------------------------------------------------------------------------

/**
 * Move an active transcript to the archive directory.
 * No-op if the active transcript doesn't exist.
 */
export function archiveSession(mindDir: string, sessionId: string): void {
  const activePath = activeTranscriptPath(mindDir, sessionId);
  if (!existsSync(activePath)) return;

  const archivePath = archiveTranscriptPath(mindDir, sessionId);
  const archiveDir = dirname(archivePath);

  if (!existsSync(archiveDir)) {
    mkdirSync(archiveDir, { recursive: true });
  }

  renameSync(activePath, archivePath);
}

// ---------------------------------------------------------------------------
// Delete (for cleanup)
// ---------------------------------------------------------------------------

/**
 * Delete an active transcript. Used for cleanup or cancellation.
 */
export function deleteTranscript(mindDir: string, sessionId: string): void {
  const path = activeTranscriptPath(mindDir, sessionId);
  if (existsSync(path)) {
    unlinkSync(path);
  }
}

// ---------------------------------------------------------------------------
// Active Session Listing
// ---------------------------------------------------------------------------

/**
 * Check if a session has an active transcript.
 */
export function hasActiveTranscript(mindDir: string, sessionId: string): boolean {
  return existsSync(activeTranscriptPath(mindDir, sessionId));
}

// ---------------------------------------------------------------------------
// Internal Parsing
// ---------------------------------------------------------------------------

function parseTranscriptFile(path: string): Message[] {
  const content = readFileSync(path, "utf-8").trim();
  if (!content) return [];

  const messages: Message[] = [];
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as TranscriptEntry;
      messages.push(entry.message);
    } catch {
      // Skip malformed lines — resilience over strictness
    }
  }
  return messages;
}

function parseTranscriptEntriesFile(path: string): TranscriptEntry[] {
  const content = readFileSync(path, "utf-8").trim();
  if (!content) return [];

  const entries: TranscriptEntry[] = [];
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line) as TranscriptEntry);
    } catch {
      // Skip malformed lines
    }
  }
  return entries;
}
