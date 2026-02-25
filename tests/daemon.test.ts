import { describe, test, expect, beforeEach, afterAll, afterEach } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { existsSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { Daemon } from "../src/daemon.ts";
import type { ConversationEvent } from "../src/conversation.ts";
import type { SessionEndEvent } from "../src/session/manager.ts";
import type { JarvisConfig } from "../src/config.ts";
import { DEFAULT_CONFIG } from "../src/config.ts";

// ---------------------------------------------------------------------------
// Test Setup
// ---------------------------------------------------------------------------

const TEST_MIND = join(tmpdir(), `jarvis-test-daemon-${Date.now()}`);
let currentDaemon: Daemon | null = null;

function makeConfig(overrides?: Partial<JarvisConfig>): JarvisConfig {
  return {
    ...DEFAULT_CONFIG,
    authToken: "sk-ant-oat01-test-token",
    mindDir: TEST_MIND,
    sessionTimeoutMs: 60000,
    ...overrides,
  };
}

function seedMind(): void {
  mkdirSync(join(TEST_MIND, "tier1"), { recursive: true });
  mkdirSync(join(TEST_MIND, "tier2"), { recursive: true });
  mkdirSync(join(TEST_MIND, "tier3"), { recursive: true });
  mkdirSync(join(TEST_MIND, "conversations", "active"), { recursive: true });
  mkdirSync(join(TEST_MIND, "conversations", "archive"), { recursive: true });

  writeFileSync(join(TEST_MIND, "tier1", "identity.md"), "# Jarvis\nI am Jarvis, a test vessel.");
  writeFileSync(join(TEST_MIND, "tier2", "projects.md"), "# Projects\nTest project.");
  writeFileSync(join(TEST_MIND, "tier3", "recent.md"), "# Recent\nTest session.");
}

beforeEach(() => {
  if (existsSync(TEST_MIND)) {
    rmSync(TEST_MIND, { recursive: true });
  }
  seedMind();
});

afterEach(() => {
  if (currentDaemon) {
    currentDaemon.shutdown();
    currentDaemon = null;
  }
});

afterAll(() => {
  if (existsSync(TEST_MIND)) {
    rmSync(TEST_MIND, { recursive: true });
  }
});

// Helper to collect events
async function collectEvents(gen: AsyncGenerator<ConversationEvent>): Promise<ConversationEvent[]> {
  const events: ConversationEvent[] = [];
  for await (const event of gen) {
    events.push(event);
  }
  return events;
}

// ---------------------------------------------------------------------------
// Daemon Lifecycle
// ---------------------------------------------------------------------------

describe("daemon lifecycle", () => {
  test("creates daemon in idle state", () => {
    const daemon = new Daemon(makeConfig());
    currentDaemon = daemon;
    const stats = daemon.getStats();
    expect(stats.status).toBe("idle");
    expect(stats.sessionId).toBeNull();
    expect(stats.messageCount).toBe(0);
  });

  test("start transitions to running", () => {
    const daemon = new Daemon(makeConfig());
    currentDaemon = daemon;
    daemon.start();
    expect(daemon.getStats().status).toBe("running");
  });

  test("start is idempotent", () => {
    const daemon = new Daemon(makeConfig());
    currentDaemon = daemon;
    daemon.start();
    daemon.start(); // Second call should be no-op
    expect(daemon.getStats().status).toBe("running");
  });

  test("shutdown transitions to shutdown", () => {
    const daemon = new Daemon(makeConfig());
    currentDaemon = daemon;
    daemon.start();
    daemon.shutdown();
    expect(daemon.getStats().status).toBe("shutdown");
  });

  test("shutdown is idempotent", () => {
    const daemon = new Daemon(makeConfig());
    currentDaemon = daemon;
    daemon.start();
    daemon.shutdown();
    const result = daemon.shutdown();
    expect(result).toBeNull();
  });

  test("uptime increases over time", async () => {
    const daemon = new Daemon(makeConfig());
    currentDaemon = daemon;
    daemon.start();
    await new Promise((r) => setTimeout(r, 50));
    expect(daemon.getStats().uptime).toBeGreaterThanOrEqual(40);
  });
});

// ---------------------------------------------------------------------------
// Session Management via Daemon
// ---------------------------------------------------------------------------

describe("daemon session management", () => {
  test("startSession creates a new session", () => {
    const daemon = new Daemon(makeConfig());
    currentDaemon = daemon;
    daemon.start();
    const session = daemon.startSession();
    expect(session.id).toBeTruthy();
    expect(daemon.getStats().sessionId).toBe(session.id);
  });

  test("endSession ends the current session", () => {
    const daemon = new Daemon(makeConfig());
    currentDaemon = daemon;
    daemon.start();
    daemon.startSession();
    const event = daemon.endSession("user_quit");
    expect(event).not.toBeNull();
    expect(event!.reason).toBe("user_quit");
    expect(daemon.getStats().sessionId).toBeNull();
  });

  test("shutdown ends active session", () => {
    const events: SessionEndEvent[] = [];
    const daemon = new Daemon(makeConfig());
    currentDaemon = daemon;
    daemon.onSessionEnd = (e) => events.push(e);
    daemon.start();
    daemon.startSession();
    daemon.shutdown();

    expect(events.length).toBe(1);
    expect(events[0]!.reason).toBe("shutdown");
  });
});

// ---------------------------------------------------------------------------
// Message Handling — Error Cases
// ---------------------------------------------------------------------------

describe("daemon handleMessage edge cases", () => {
  test("returns error when daemon is shut down", async () => {
    const daemon = new Daemon(makeConfig());
    currentDaemon = daemon;
    daemon.start();
    daemon.shutdown();

    const events = await collectEvents(daemon.handleMessage("hello"));

    const errors = events.filter((e) => e.type === "error");
    expect(errors.length).toBe(1);
    expect((errors[0] as { error: Error }).error.message).toContain("shut down");
  });

  test("auto-starts daemon if idle when handling message", async () => {
    const daemon = new Daemon(makeConfig());
    currentDaemon = daemon;
    // Don't call start() — handleMessage should auto-start

    // This will fail at the API call (no real API), but it should auto-start first
    await collectEvents(daemon.handleMessage("test auto-start"));
    // Even if API fails, daemon should now be running
    expect(daemon.getStats().status).not.toBe("idle");
  });

  test("auto-creates session when handling message", async () => {
    const daemon = new Daemon(makeConfig());
    currentDaemon = daemon;
    daemon.start();
    // Don't call startSession() — handleMessage should auto-create

    // Will fail at API call, but session should be created
    const result = await collectEvents(daemon.handleMessage("test auto-session"));
    // Session should have been created before the API error
    expect(result.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Session End Callback
// ---------------------------------------------------------------------------

describe("daemon session end callback", () => {
  test("onSessionEnd fires when session ends", () => {
    const events: SessionEndEvent[] = [];
    const daemon = new Daemon(makeConfig());
    currentDaemon = daemon;
    daemon.onSessionEnd = (e) => events.push(e);

    daemon.start();
    daemon.startSession();
    daemon.endSession("user_quit");

    expect(events.length).toBe(1);
    expect(events[0]!.reason).toBe("user_quit");
  });

  test("onSessionEnd not fired when no session active", () => {
    const events: SessionEndEvent[] = [];
    const daemon = new Daemon(makeConfig());
    currentDaemon = daemon;
    daemon.onSessionEnd = (e) => events.push(e);

    daemon.start();
    daemon.endSession("user_quit");

    expect(events.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

describe("daemon stats", () => {
  test("tracks message count through session", () => {
    const daemon = new Daemon(makeConfig());
    currentDaemon = daemon;
    daemon.start();
    daemon.startSession();

    // Manually add messages via the session manager
    const mgr = daemon.getSessionManager();
    mgr.addMessage({ role: "user", content: "one" });
    mgr.addMessage({ role: "assistant", content: "two" });

    expect(daemon.getStats().messageCount).toBe(2);
  });

  test("message count resets on new session", () => {
    const daemon = new Daemon(makeConfig());
    currentDaemon = daemon;
    daemon.start();
    daemon.startSession();

    const mgr = daemon.getSessionManager();
    mgr.addMessage({ role: "user", content: "old session" });

    daemon.startSession(); // New session
    expect(daemon.getStats().messageCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Wake — Autonomous Task Execution
// ---------------------------------------------------------------------------

describe("daemon wake", () => {
  test("wake returns error for unknown task", async () => {
    const daemon = new Daemon(makeConfig());
    currentDaemon = daemon;

    const result = await daemon.wake("nonexistent");
    expect(result.success).toBe(false);
    expect(result.error).toContain("Unknown task");
  });

  test("wake returns result with correct task name", async () => {
    const daemon = new Daemon(makeConfig({ apiBaseUrl: "http://127.0.0.1:1" }));
    currentDaemon = daemon;

    const result = await daemon.wake("morning_routine");
    expect(result.task).toBe("morning_routine");
  });

  test("wake writes log file", async () => {
    const daemon = new Daemon(makeConfig());
    currentDaemon = daemon;

    const result = await daemon.wake("nonexistent");
    expect(existsSync(result.logPath)).toBe(true);
  });

  test("wake does not require daemon to be started", async () => {
    const daemon = new Daemon(makeConfig());
    currentDaemon = daemon;

    // Wake is one-shot — doesn't need start()
    expect(daemon.getStats().status).toBe("idle");
    const result = await daemon.wake("nonexistent");
    expect(result.task).toBe("nonexistent");
    // Daemon status should remain idle
    expect(daemon.getStats().status).toBe("idle");
  });
});
