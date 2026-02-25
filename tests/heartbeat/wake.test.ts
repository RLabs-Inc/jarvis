import { describe, test, expect, beforeEach, afterAll } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { existsSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { handleWake } from "../../src/heartbeat/wake.ts";
import type { JarvisConfig } from "../../src/config.ts";
import { DEFAULT_CONFIG } from "../../src/config.ts";
import { registerTask, BUILTIN_TASKS } from "../../src/heartbeat/tasks.ts";
import type { TaskDefinition } from "../../src/heartbeat/tasks.ts";

// ---------------------------------------------------------------------------
// Test Setup
// ---------------------------------------------------------------------------

const TEST_MIND = join(tmpdir(), `jarvis-test-wake-${Date.now()}`);

function makeConfig(overrides?: Partial<JarvisConfig>): JarvisConfig {
  return {
    ...DEFAULT_CONFIG,
    authToken: "sk-ant-oat01-test-wake-token",
    mindDir: TEST_MIND,
    requestTimeoutMs: 500,
    ...overrides,
  };
}

function seedMind(): void {
  mkdirSync(join(TEST_MIND, "tier1"), { recursive: true });
  mkdirSync(join(TEST_MIND, "tier2"), { recursive: true });
  mkdirSync(join(TEST_MIND, "tier3"), { recursive: true });
  mkdirSync(join(TEST_MIND, "conversations", "active"), { recursive: true });
  mkdirSync(join(TEST_MIND, "conversations", "archive"), { recursive: true });

  writeFileSync(join(TEST_MIND, "tier1", "identity.md"), "# Jarvis\nTest vessel.");
  writeFileSync(join(TEST_MIND, "tier2", "projects.md"), "# Projects\nNone.");
  writeFileSync(join(TEST_MIND, "tier3", "recent.md"), "# Recent\nNothing.");
}

beforeEach(() => {
  if (existsSync(TEST_MIND)) {
    rmSync(TEST_MIND, { recursive: true });
  }
  seedMind();
});

afterAll(() => {
  if (existsSync(TEST_MIND)) {
    rmSync(TEST_MIND, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// Unknown Task
// ---------------------------------------------------------------------------

describe("handleWake — unknown task", () => {
  test("returns error for unknown task name", async () => {
    const config = makeConfig();
    const result = await handleWake("nonexistent_task", config);

    expect(result.success).toBe(false);
    expect(result.task).toBe("nonexistent_task");
    expect(result.error).toContain("Unknown task");
    expect(result.throttled).toBe(false);
  });

  test("writes log file for unknown task", async () => {
    const config = makeConfig();
    const result = await handleWake("nonexistent_task", config);

    expect(existsSync(result.logPath)).toBe(true);
    const log = JSON.parse(readFileSync(result.logPath, "utf-8"));
    expect(log.success).toBe(false);
    expect(log.error).toContain("Unknown task");
  });
});

// ---------------------------------------------------------------------------
// Rate Limit Throttling
// ---------------------------------------------------------------------------

describe("handleWake — rate limits", () => {
  test("continues when rate limit check fails (network error)", async () => {
    // With a bad API URL, checkUsage will throw. The wake handler
    // should still attempt to run the task (and fail at the API call,
    // not at the rate limit check).
    const config = makeConfig({
      apiBaseUrl: "http://127.0.0.1:1", // unreachable
    });

    const result = await handleWake("morning_routine", config);

    // Should have attempted the task (not throttled)
    expect(result.throttled).toBe(false);
    // Will fail at the API call — that's expected
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Wake Result Structure
// ---------------------------------------------------------------------------

describe("handleWake — result structure", () => {
  test("result has all required fields", async () => {
    const config = makeConfig({ apiBaseUrl: "http://127.0.0.1:1" });
    const result = await handleWake("morning_routine", config);

    expect(result.task).toBe("morning_routine");
    expect(typeof result.success).toBe("boolean");
    expect(typeof result.throttled).toBe("boolean");
    expect(typeof result.model).toBe("string");
    expect(typeof result.response).toBe("string");
    expect(typeof result.durationMs).toBe("number");
    expect(typeof result.logPath).toBe("string");
  });

  test("durationMs is non-negative", async () => {
    const config = makeConfig({ apiBaseUrl: "http://127.0.0.1:1" });
    const result = await handleWake("morning_routine", config);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  test("logPath includes task name", async () => {
    const config = makeConfig({ apiBaseUrl: "http://127.0.0.1:1" });
    const result = await handleWake("morning_routine", config);
    expect(result.logPath).toContain("morning_routine");
  });

  test("logPath is under mind/heartbeat/logs/", async () => {
    const config = makeConfig({ apiBaseUrl: "http://127.0.0.1:1" });
    const result = await handleWake("morning_routine", config);
    expect(result.logPath).toContain(join(TEST_MIND, "heartbeat", "logs"));
  });
});

// ---------------------------------------------------------------------------
// Log File Quality
// ---------------------------------------------------------------------------

describe("handleWake — logging", () => {
  test("log file is valid JSON", async () => {
    const config = makeConfig({ apiBaseUrl: "http://127.0.0.1:1" });
    const result = await handleWake("morning_routine", config);

    expect(existsSync(result.logPath)).toBe(true);
    const content = readFileSync(result.logPath, "utf-8");
    const parsed = JSON.parse(content);
    expect(parsed.task).toBe("morning_routine");
  });

  test("creates heartbeat/logs directory if missing", async () => {
    const logsDir = join(TEST_MIND, "heartbeat", "logs");
    expect(existsSync(logsDir)).toBe(false);

    const config = makeConfig({ apiBaseUrl: "http://127.0.0.1:1" });
    await handleWake("morning_routine", config);

    expect(existsSync(logsDir)).toBe(true);
  });

  test("log file has correct structure", async () => {
    const config = makeConfig({ apiBaseUrl: "http://127.0.0.1:1" });
    const result = await handleWake("morning_routine", config);

    const log = JSON.parse(readFileSync(result.logPath, "utf-8"));
    expect(log).toHaveProperty("task");
    expect(log).toHaveProperty("success");
    expect(log).toHaveProperty("throttled");
    expect(log).toHaveProperty("model");
    expect(log).toHaveProperty("response");
    expect(log).toHaveProperty("durationMs");
    expect(log).toHaveProperty("logPath");
  });
});

// ---------------------------------------------------------------------------
// Task-Specific Model Selection
// ---------------------------------------------------------------------------

describe("handleWake — model selection", () => {
  test("uses task preferredModel when available", async () => {
    // check_rate_limits has preferredModel: haiku
    const config = makeConfig({ apiBaseUrl: "http://127.0.0.1:1" });
    const result = await handleWake("check_rate_limits", config);

    // When rate limit check fails (unreachable URL), it falls through to
    // the task's preferred model
    expect(result.model).toBe("claude-haiku-4-5-20251001");
  });

  test("uses config model when task has no preference", async () => {
    const config = makeConfig({
      apiBaseUrl: "http://127.0.0.1:1",
      model: "claude-sonnet-4-6",
    });
    const result = await handleWake("morning_routine", config);

    expect(result.model).toBe("claude-sonnet-4-6");
  });
});

// ---------------------------------------------------------------------------
// Custom Task Registration + Wake
// ---------------------------------------------------------------------------

describe("handleWake — custom tasks", () => {
  test("can wake with a dynamically registered task", async () => {
    const custom: TaskDefinition = {
      name: "test_wake_custom",
      description: "Test custom task",
      systemPrompt: "You are a test.",
      userMessage: "Say hello.",
      allowTools: false,
    };

    registerTask(custom);

    const config = makeConfig({ apiBaseUrl: "http://127.0.0.1:1" });
    const result = await handleWake("test_wake_custom", config);

    expect(result.task).toBe("test_wake_custom");
    // Will fail at API call, but that's fine — we're testing the pipeline
    expect(result.success).toBe(false);

    // Clean up
    BUILTIN_TASKS.delete("test_wake_custom");
  });
});
