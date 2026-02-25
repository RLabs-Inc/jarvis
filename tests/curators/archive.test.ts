import { describe, test, expect, beforeEach, afterAll } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { existsSync, readFileSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import {
  archiveWithMetadata,
  loadArchiveMetadata,
  listArchivedSessions,
  metadataPath,
} from "../../src/curators/archive.ts";
import type { SessionEndEvent } from "../../src/session/manager.ts";

const TEST_MIND = join(tmpdir(), `jarvis-test-archive-${Date.now()}`);

function makeEndEvent(overrides: Partial<SessionEndEvent> = {}): SessionEndEvent {
  return {
    sessionId: "sess-001",
    reason: "user_quit",
    messageCount: 12,
    durationMs: 300_000,
    ...overrides,
  };
}

beforeEach(() => {
  if (existsSync(TEST_MIND)) {
    rmSync(TEST_MIND, { recursive: true });
  }
  mkdirSync(join(TEST_MIND, "conversations", "archive"), { recursive: true });
});

afterAll(() => {
  if (existsSync(TEST_MIND)) {
    rmSync(TEST_MIND, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// metadataPath
// ---------------------------------------------------------------------------

describe("metadataPath", () => {
  test("returns .meta.json path in archive", () => {
    const path = metadataPath(TEST_MIND, "sess-001");
    expect(path).toBe(join(TEST_MIND, "conversations", "archive", "sess-001.meta.json"));
  });
});

// ---------------------------------------------------------------------------
// archiveWithMetadata
// ---------------------------------------------------------------------------

describe("archiveWithMetadata", () => {
  test("creates metadata file", () => {
    const event = makeEndEvent();
    archiveWithMetadata(TEST_MIND, event);

    const path = metadataPath(TEST_MIND, "sess-001");
    expect(existsSync(path)).toBe(true);
  });

  test("metadata contains correct fields", () => {
    const event = makeEndEvent({ sessionId: "sess-fields", messageCount: 8, durationMs: 60_000 });
    const metadata = archiveWithMetadata(TEST_MIND, event);

    expect(metadata.sessionId).toBe("sess-fields");
    expect(metadata.reason).toBe("user_quit");
    expect(metadata.messageCount).toBe(8);
    expect(metadata.durationMs).toBe(60_000);
    expect(metadata.endedAt).toBeTruthy();
    expect(metadata.transcriptPath).toContain("sess-fields.jsonl");
  });

  test("metadata is valid JSON on disk", () => {
    archiveWithMetadata(TEST_MIND, makeEndEvent());
    const raw = readFileSync(metadataPath(TEST_MIND, "sess-001"), "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed.sessionId).toBe("sess-001");
  });

  test("creates archive directory if missing", () => {
    const freshMind = join(tmpdir(), `jarvis-archive-fresh-${Date.now()}`);
    archiveWithMetadata(freshMind, makeEndEvent());
    expect(existsSync(metadataPath(freshMind, "sess-001"))).toBe(true);
    rmSync(freshMind, { recursive: true });
  });
});

// ---------------------------------------------------------------------------
// loadArchiveMetadata
// ---------------------------------------------------------------------------

describe("loadArchiveMetadata", () => {
  test("loads metadata from disk", () => {
    archiveWithMetadata(TEST_MIND, makeEndEvent({ sessionId: "sess-load" }));
    const metadata = loadArchiveMetadata(TEST_MIND, "sess-load");

    expect(metadata).not.toBeNull();
    expect(metadata!.sessionId).toBe("sess-load");
    expect(metadata!.messageCount).toBe(12);
  });

  test("returns null for nonexistent session", () => {
    expect(loadArchiveMetadata(TEST_MIND, "nope")).toBeNull();
  });

  test("returns null for malformed metadata", () => {
    const path = metadataPath(TEST_MIND, "bad-meta");
    writeFileSync(path, "not valid json{{{");
    expect(loadArchiveMetadata(TEST_MIND, "bad-meta")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// listArchivedSessions
// ---------------------------------------------------------------------------

describe("listArchivedSessions", () => {
  test("lists sessions with metadata files", () => {
    archiveWithMetadata(TEST_MIND, makeEndEvent({ sessionId: "sess-a" }));
    archiveWithMetadata(TEST_MIND, makeEndEvent({ sessionId: "sess-b" }));
    archiveWithMetadata(TEST_MIND, makeEndEvent({ sessionId: "sess-c" }));

    const sessions = listArchivedSessions(TEST_MIND);
    expect(sessions).toEqual(["sess-a", "sess-b", "sess-c"]);
  });

  test("ignores non-metadata files", () => {
    archiveWithMetadata(TEST_MIND, makeEndEvent({ sessionId: "sess-only" }));
    // Write a .jsonl file that should be ignored
    writeFileSync(
      join(TEST_MIND, "conversations", "archive", "sess-only.jsonl"),
      '{"timestamp":"2026-02-21","message":{"role":"user","content":"hi"}}\n',
    );

    const sessions = listArchivedSessions(TEST_MIND);
    expect(sessions).toEqual(["sess-only"]);
  });

  test("returns empty array for missing directory", () => {
    const empty = join(tmpdir(), `jarvis-empty-${Date.now()}`);
    expect(listArchivedSessions(empty)).toEqual([]);
  });
});
