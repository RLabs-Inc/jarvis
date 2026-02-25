import { describe, test, expect, beforeEach, afterAll } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { existsSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import { runCuration, triggerCuration } from "../../src/curators/orchestrator.ts";
import type { CurationResult } from "../../src/curators/orchestrator.ts";
import { appendMessage, archiveSession } from "../../src/session/transcript.ts";
import { metadataPath } from "../../src/curators/archive.ts";
import type { JarvisConfig } from "../../src/config.ts";
import type { SessionEndEvent } from "../../src/session/manager.ts";

const TEST_MIND = join(tmpdir(), `jarvis-test-orchestrator-${Date.now()}`);

// Mock the ClaudeClient at the module level
// We use a custom approach: create the config and override the API URL
// so it hits nothing, then mock via the internal curator functions.

// For orchestrator tests, we need to mock the ClaudeClient constructor
// used internally. We do this by providing a config with a mock API URL
// and using Bun's mock capabilities.

function makeConfig(): JarvisConfig {
  return {
    authToken: "test-token",
    model: "claude-opus-4-6",
    curationModel: "claude-haiku-4-5-20251001",
    tierBudgets: { tier1: 20000, tier2: 25000, tier3: 15000, tier4: 140000 },
    mindDir: TEST_MIND,
    apiBaseUrl: "http://localhost:19999", // Non-existent to catch accidental real calls
    sessionTimeoutMs: 30 * 60 * 1000,
    requestTimeoutMs: 500, // Fast timeout for tests — fail immediately on unreachable URL
  };
}

function makeEndEvent(overrides: Partial<SessionEndEvent> = {}): SessionEndEvent {
  return {
    sessionId: "sess-orch-001",
    reason: "user_quit",
    messageCount: 5,
    durationMs: 120_000,
    ...overrides,
  };
}

beforeEach(() => {
  if (existsSync(TEST_MIND)) {
    rmSync(TEST_MIND, { recursive: true });
  }
  mkdirSync(join(TEST_MIND, "tier2"), { recursive: true });
  mkdirSync(join(TEST_MIND, "tier3"), { recursive: true });
  mkdirSync(join(TEST_MIND, "conversations", "active"), { recursive: true });
  mkdirSync(join(TEST_MIND, "conversations", "archive"), { recursive: true });
});

afterAll(() => {
  if (existsSync(TEST_MIND)) {
    rmSync(TEST_MIND, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// runCuration
// ---------------------------------------------------------------------------

describe("runCuration", () => {
  test("archive curator runs even without API (no transcript)", async () => {
    const config = makeConfig();
    const event = makeEndEvent({ sessionId: "sess-empty" });

    // No transcript → tier2/tier3 curators will return empty results
    // Archive curator will still write metadata
    // BUT the ClaudeClient will fail because the API URL is fake.
    // Since there's no transcript, tier2/tier3 will short-circuit and never call the API.

    const result = await runCuration(config, event);

    // Archive should always succeed (no API call)
    expect(result.archive).not.toBeNull();
    expect(result.archive!.sessionId).toBe("sess-empty");

    // Tier 2 and 3 should return empty results (no transcript)
    expect(result.tier2!.filesUpdated).toEqual([]);
    expect(result.tier3!.filesUpdated).toEqual([]);

    // No errors expected
    expect(result.errors).toEqual([]);
  });

  test("captures duration", async () => {
    const config = makeConfig();
    const event = makeEndEvent({ sessionId: "sess-dur" });

    const result = await runCuration(config, event);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  test("reports session ID", async () => {
    const config = makeConfig();
    const event = makeEndEvent({ sessionId: "sess-id-test" });

    const result = await runCuration(config, event);
    expect(result.sessionId).toBe("sess-id-test");
  });

  test("fires onComplete callback", async () => {
    const config = makeConfig();
    const event = makeEndEvent({ sessionId: "sess-cb" });

    let callbackResult: CurationResult | null = null;
    await runCuration(config, event, (r) => {
      callbackResult = r;
    });

    expect(callbackResult).not.toBeNull();
    expect(callbackResult!.sessionId).toBe("sess-cb");
  });

  test("captures errors without failing entire curation", async () => {
    const config = makeConfig();

    // Create a transcript so curators actually try to call the API
    appendMessage(TEST_MIND, "sess-err", { role: "user", content: "Hello" });
    archiveSession(TEST_MIND, "sess-err");

    const event = makeEndEvent({ sessionId: "sess-err" });

    // This will fail for tier2/tier3 because the API URL is fake
    // But archive should still succeed
    const result = await runCuration(config, event);

    // Archive always works (no API needed)
    expect(result.archive).not.toBeNull();
    expect(result.archive!.sessionId).toBe("sess-err");

    // Tier 2 and 3 should have errors (API URL is unreachable)
    expect(result.errors.length).toBeGreaterThan(0);
    const curatorNames = result.errors.map((e) => e.curator);
    expect(curatorNames).toContain("tier2");
    expect(curatorNames).toContain("tier3");
  });

  test("writes archive metadata to disk", async () => {
    const config = makeConfig();
    const event = makeEndEvent({ sessionId: "sess-meta" });

    await runCuration(config, event);

    expect(existsSync(metadataPath(TEST_MIND, "sess-meta"))).toBe(true);
    const raw = readFileSync(metadataPath(TEST_MIND, "sess-meta"), "utf-8");
    const meta = JSON.parse(raw);
    expect(meta.sessionId).toBe("sess-meta");
    expect(meta.messageCount).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// triggerCuration (fire-and-forget)
// ---------------------------------------------------------------------------

describe("triggerCuration", () => {
  test("runs without blocking", async () => {
    const config = makeConfig();
    const event = makeEndEvent({ sessionId: "sess-trigger" });

    let completed = false;
    triggerCuration(config, event, () => {
      completed = true;
    });

    // Wait a bit for the async operation
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(completed).toBe(true);
  });

  test("captures completion even with curator errors", async () => {
    const config = makeConfig();

    // Create a transcript so curators attempt API calls (which will fail)
    appendMessage(TEST_MIND, "sess-fail", { role: "user", content: "Hello" });
    archiveSession(TEST_MIND, "sess-fail");

    const event = makeEndEvent({ sessionId: "sess-fail" });

    let completedResult: CurationResult | null = null;
    triggerCuration(config, event, (r) => {
      completedResult = r;
    });

    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(completedResult).not.toBeNull();
    // Archive should succeed, tier2/tier3 should have errors
    expect(completedResult!.archive).not.toBeNull();
    expect(completedResult!.errors.length).toBeGreaterThan(0);
  });
});
