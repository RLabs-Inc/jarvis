import { describe, test, expect, beforeEach, afterAll } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { existsSync, rmSync, mkdirSync } from "node:fs";
import { SessionManager } from "../../src/session/manager.ts";
import type { SessionEndEvent } from "../../src/session/manager.ts";
import { activeTranscriptPath, archiveTranscriptPath } from "../../src/session/transcript.ts";

const TEST_MIND = join(tmpdir(), `jarvis-test-manager-${Date.now()}`);

beforeEach(() => {
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
// Session Lifecycle
// ---------------------------------------------------------------------------

describe("session lifecycle", () => {
  test("startSession creates an active session", () => {
    const mgr = new SessionManager(TEST_MIND, 30000);
    const session = mgr.startSession();

    expect(session.id).toBeTruthy();
    expect(session.status).toBe("active");
    expect(session.messageCount).toBe(0);
    expect(session.startTime).toBeTruthy();
    mgr.destroy();
  });

  test("getActiveSession returns the current session", () => {
    const mgr = new SessionManager(TEST_MIND, 30000);
    expect(mgr.getActiveSession()).toBeNull();

    const session = mgr.startSession();
    expect(mgr.getActiveSession()).toBe(session);
    mgr.destroy();
  });

  test("endSession marks session as ended", () => {
    const mgr = new SessionManager(TEST_MIND, 30000);
    mgr.startSession();

    const event = mgr.endSession("user_quit");
    expect(event).not.toBeNull();
    expect(event!.reason).toBe("user_quit");
    expect(mgr.getActiveSession()).toBeNull();
    mgr.destroy();
  });

  test("endSession returns null when no active session", () => {
    const mgr = new SessionManager(TEST_MIND, 30000);
    expect(mgr.endSession("user_quit")).toBeNull();
    mgr.destroy();
  });

  test("endSession returns null when session already ended", () => {
    const mgr = new SessionManager(TEST_MIND, 30000);
    mgr.startSession();
    mgr.endSession("user_quit");
    expect(mgr.endSession("user_quit")).toBeNull();
    mgr.destroy();
  });

  test("starting a new session ends the previous one", () => {
    const events: SessionEndEvent[] = [];
    const mgr = new SessionManager(TEST_MIND, 30000, (e) => events.push(e));

    mgr.startSession();
    mgr.addMessage({ role: "user", content: "first session" });

    const second = mgr.startSession();
    expect(events.length).toBe(1);
    expect(events[0]!.reason).toBe("new_session");
    expect(mgr.getActiveSession()!.id).toBe(second.id);
    mgr.destroy();
  });
});

// ---------------------------------------------------------------------------
// Message Recording
// ---------------------------------------------------------------------------

describe("message recording", () => {
  test("addMessage records to transcript", () => {
    const mgr = new SessionManager(TEST_MIND, 30000);
    const session = mgr.startSession();

    mgr.addMessage({ role: "user", content: "hello" });
    mgr.addMessage({ role: "assistant", content: "hi there" });

    expect(session.messageCount).toBe(2);

    const messages = mgr.getMessages();
    expect(messages.length).toBe(2);
    expect(messages[0]!.content).toBe("hello");
    expect(messages[1]!.content).toBe("hi there");
    mgr.destroy();
  });

  test("addMessage throws without active session", () => {
    const mgr = new SessionManager(TEST_MIND, 30000);
    expect(() => {
      mgr.addMessage({ role: "user", content: "oops" });
    }).toThrow("No active session");
    mgr.destroy();
  });

  test("getMessages returns empty when no session", () => {
    const mgr = new SessionManager(TEST_MIND, 30000);
    expect(mgr.getMessages()).toEqual([]);
    mgr.destroy();
  });
});

// ---------------------------------------------------------------------------
// Session End Event
// ---------------------------------------------------------------------------

describe("session end event", () => {
  test("fires callback on session end", () => {
    const events: SessionEndEvent[] = [];
    const mgr = new SessionManager(TEST_MIND, 30000, (e) => events.push(e));

    const session = mgr.startSession();
    mgr.addMessage({ role: "user", content: "test" });
    mgr.endSession("shutdown");

    expect(events.length).toBe(1);
    expect(events[0]!.sessionId).toBe(session.id);
    expect(events[0]!.reason).toBe("shutdown");
    expect(events[0]!.messageCount).toBe(1);
    expect(events[0]!.durationMs).toBeGreaterThanOrEqual(0);
    mgr.destroy();
  });

  test("archives transcript on session end", () => {
    const mgr = new SessionManager(TEST_MIND, 30000);
    const session = mgr.startSession();
    mgr.addMessage({ role: "user", content: "archive me" });

    mgr.endSession("user_quit");

    // Active should be gone, archive should exist
    expect(existsSync(activeTranscriptPath(TEST_MIND, session.id))).toBe(false);
    expect(existsSync(archiveTranscriptPath(TEST_MIND, session.id))).toBe(true);
    mgr.destroy();
  });
});

// ---------------------------------------------------------------------------
// Idle Timeout
// ---------------------------------------------------------------------------

describe("idle timeout", () => {
  test("fires idle timeout after configured duration", async () => {
    const events: SessionEndEvent[] = [];
    const mgr = new SessionManager(TEST_MIND, 100, (e) => events.push(e)); // 100ms timeout

    mgr.startSession();
    mgr.addMessage({ role: "user", content: "idle test" });

    // Wait for the timeout
    await new Promise((r) => setTimeout(r, 200));

    expect(events.length).toBe(1);
    expect(events[0]!.reason).toBe("idle_timeout");
    expect(mgr.getActiveSession()).toBeNull();
    mgr.destroy();
  });

  test("idle timer resets on new message", async () => {
    const events: SessionEndEvent[] = [];
    const mgr = new SessionManager(TEST_MIND, 150, (e) => events.push(e));

    mgr.startSession();
    mgr.addMessage({ role: "user", content: "first" });

    // Wait 100ms (less than timeout), then add another message
    await new Promise((r) => setTimeout(r, 100));
    mgr.addMessage({ role: "assistant", content: "reply" });

    // Wait another 100ms — shouldn't timeout yet (timer was reset)
    await new Promise((r) => setTimeout(r, 100));
    expect(events.length).toBe(0);
    expect(mgr.getActiveSession()).not.toBeNull();

    // Wait until it actually times out
    await new Promise((r) => setTimeout(r, 100));
    expect(events.length).toBe(1);
    mgr.destroy();
  });

  test("no timeout when idle timeout is 0", async () => {
    const events: SessionEndEvent[] = [];
    const mgr = new SessionManager(TEST_MIND, 0, (e) => events.push(e));

    mgr.startSession();
    await new Promise((r) => setTimeout(r, 50));

    expect(events.length).toBe(0);
    expect(mgr.getActiveSession()).not.toBeNull();
    mgr.destroy();
  });
});

// ---------------------------------------------------------------------------
// Session Duration
// ---------------------------------------------------------------------------

describe("session duration", () => {
  test("tracks duration of active session", async () => {
    const mgr = new SessionManager(TEST_MIND, 30000);
    mgr.startSession();

    await new Promise((r) => setTimeout(r, 50));
    const duration = mgr.getSessionDurationMs();
    expect(duration).toBeGreaterThanOrEqual(40);
    mgr.destroy();
  });

  test("returns 0 when no session", () => {
    const mgr = new SessionManager(TEST_MIND, 30000);
    expect(mgr.getSessionDurationMs()).toBe(0);
    mgr.destroy();
  });
});

// ---------------------------------------------------------------------------
// Destroy
// ---------------------------------------------------------------------------

describe("destroy", () => {
  test("clears idle timer on destroy", async () => {
    const events: SessionEndEvent[] = [];
    const mgr = new SessionManager(TEST_MIND, 100, (e) => events.push(e));

    mgr.startSession();
    mgr.destroy();

    await new Promise((r) => setTimeout(r, 200));
    // Timer should have been cleared — no idle timeout event
    expect(events.length).toBe(0);
  });
});
