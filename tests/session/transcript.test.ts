import { describe, test, expect, beforeEach, afterAll } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { existsSync, readFileSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import {
  appendMessage,
  loadTranscript,
  loadTranscriptEntries,
  archiveSession,
  deleteTranscript,
  hasActiveTranscript,
  activeTranscriptPath,
  archiveTranscriptPath,
} from "../../src/session/transcript.ts";
import type { Message } from "../../src/api/types.ts";

const TEST_MIND = join(tmpdir(), `jarvis-test-transcript-${Date.now()}`);

beforeEach(() => {
  // Clean and recreate the test mind directory
  if (existsSync(TEST_MIND)) {
    rmSync(TEST_MIND, { recursive: true });
  }
  mkdirSync(join(TEST_MIND, "conversations", "active"), { recursive: true });
  mkdirSync(join(TEST_MIND, "conversations", "archive"), { recursive: true });
});

afterAll(() => {
  if (existsSync(TEST_MIND)) {
    rmSync(TEST_MIND, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

describe("transcript paths", () => {
  test("active path is in conversations/active/", () => {
    const path = activeTranscriptPath(TEST_MIND, "sess-001");
    expect(path).toBe(join(TEST_MIND, "conversations", "active", "sess-001.jsonl"));
  });

  test("archive path is in conversations/archive/", () => {
    const path = archiveTranscriptPath(TEST_MIND, "sess-001");
    expect(path).toBe(join(TEST_MIND, "conversations", "archive", "sess-001.jsonl"));
  });
});

// ---------------------------------------------------------------------------
// Append
// ---------------------------------------------------------------------------

describe("appendMessage", () => {
  test("creates file and appends a message", () => {
    const msg: Message = { role: "user", content: "Hello Jarvis" };
    appendMessage(TEST_MIND, "sess-append", msg);

    const path = activeTranscriptPath(TEST_MIND, "sess-append");
    expect(existsSync(path)).toBe(true);

    const raw = readFileSync(path, "utf-8").trim();
    const entry = JSON.parse(raw);
    expect(entry.message.role).toBe("user");
    expect(entry.message.content).toBe("Hello Jarvis");
    expect(entry.timestamp).toBeTruthy();
  });

  test("appends multiple messages as separate lines", () => {
    appendMessage(TEST_MIND, "sess-multi", { role: "user", content: "first" });
    appendMessage(TEST_MIND, "sess-multi", { role: "assistant", content: "second" });
    appendMessage(TEST_MIND, "sess-multi", { role: "user", content: "third" });

    const path = activeTranscriptPath(TEST_MIND, "sess-multi");
    const lines = readFileSync(path, "utf-8").trim().split("\n");
    expect(lines.length).toBe(3);
  });

  test("handles ContentBlock array messages", () => {
    const msg: Message = {
      role: "assistant",
      content: [
        { type: "text", text: "Let me check..." },
        { type: "tool_use", id: "tu_1", name: "bash", input: { command: "ls" } },
      ],
    };
    appendMessage(TEST_MIND, "sess-blocks", msg);

    const loaded = loadTranscript(TEST_MIND, "sess-blocks");
    expect(loaded.length).toBe(1);
    expect(Array.isArray(loaded[0]!.content)).toBe(true);
  });

  test("creates directories if they don't exist", () => {
    const freshMind = join(tmpdir(), `jarvis-fresh-${Date.now()}`);
    appendMessage(freshMind, "new-sess", { role: "user", content: "hi" });
    expect(existsSync(activeTranscriptPath(freshMind, "new-sess"))).toBe(true);
    rmSync(freshMind, { recursive: true });
  });
});

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

describe("loadTranscript", () => {
  test("loads messages from active transcript", () => {
    appendMessage(TEST_MIND, "sess-load", { role: "user", content: "one" });
    appendMessage(TEST_MIND, "sess-load", { role: "assistant", content: "two" });

    const messages = loadTranscript(TEST_MIND, "sess-load");
    expect(messages.length).toBe(2);
    expect(messages[0]!.role).toBe("user");
    expect(messages[0]!.content).toBe("one");
    expect(messages[1]!.role).toBe("assistant");
    expect(messages[1]!.content).toBe("two");
  });

  test("returns empty array for nonexistent session", () => {
    const messages = loadTranscript(TEST_MIND, "nonexistent");
    expect(messages).toEqual([]);
  });

  test("loads from archive if active doesn't exist", () => {
    appendMessage(TEST_MIND, "sess-archived", { role: "user", content: "archived msg" });
    archiveSession(TEST_MIND, "sess-archived");

    const messages = loadTranscript(TEST_MIND, "sess-archived");
    expect(messages.length).toBe(1);
    expect(messages[0]!.content).toBe("archived msg");
  });

  test("skips malformed lines gracefully", () => {
    const path = activeTranscriptPath(TEST_MIND, "sess-malformed");
    writeFileSync(
      path,
      '{"timestamp":"2026-02-21T00:00:00Z","message":{"role":"user","content":"good"}}\nBROKEN LINE\n{"timestamp":"2026-02-21T00:00:01Z","message":{"role":"assistant","content":"also good"}}\n',
    );

    const messages = loadTranscript(TEST_MIND, "sess-malformed");
    expect(messages.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Load Entries (with metadata)
// ---------------------------------------------------------------------------

describe("loadTranscriptEntries", () => {
  test("returns entries with timestamps", () => {
    appendMessage(TEST_MIND, "sess-entries", { role: "user", content: "hello" });

    const entries = loadTranscriptEntries(TEST_MIND, "sess-entries");
    expect(entries.length).toBe(1);
    expect(entries[0]!.timestamp).toBeTruthy();
    expect(entries[0]!.message.content).toBe("hello");
  });

  test("returns empty array for nonexistent session", () => {
    expect(loadTranscriptEntries(TEST_MIND, "nope")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Archive
// ---------------------------------------------------------------------------

describe("archiveSession", () => {
  test("moves transcript from active to archive", () => {
    appendMessage(TEST_MIND, "sess-arch", { role: "user", content: "moving" });

    const activePath = activeTranscriptPath(TEST_MIND, "sess-arch");
    expect(existsSync(activePath)).toBe(true);

    archiveSession(TEST_MIND, "sess-arch");

    expect(existsSync(activePath)).toBe(false);
    expect(existsSync(archiveTranscriptPath(TEST_MIND, "sess-arch"))).toBe(true);
  });

  test("no-op for nonexistent session", () => {
    // Should not throw
    archiveSession(TEST_MIND, "nonexistent");
  });
});

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

describe("deleteTranscript", () => {
  test("removes active transcript", () => {
    appendMessage(TEST_MIND, "sess-del", { role: "user", content: "delete me" });
    expect(hasActiveTranscript(TEST_MIND, "sess-del")).toBe(true);

    deleteTranscript(TEST_MIND, "sess-del");
    expect(hasActiveTranscript(TEST_MIND, "sess-del")).toBe(false);
  });

  test("no-op for nonexistent session", () => {
    deleteTranscript(TEST_MIND, "nonexistent");
  });
});

// ---------------------------------------------------------------------------
// hasActiveTranscript
// ---------------------------------------------------------------------------

describe("hasActiveTranscript", () => {
  test("returns true when active transcript exists", () => {
    appendMessage(TEST_MIND, "sess-has", { role: "user", content: "hi" });
    expect(hasActiveTranscript(TEST_MIND, "sess-has")).toBe(true);
  });

  test("returns false when no active transcript", () => {
    expect(hasActiveTranscript(TEST_MIND, "nope")).toBe(false);
  });

  test("returns false after archiving", () => {
    appendMessage(TEST_MIND, "sess-gone", { role: "user", content: "bye" });
    archiveSession(TEST_MIND, "sess-gone");
    expect(hasActiveTranscript(TEST_MIND, "sess-gone")).toBe(false);
  });
});
