import { describe, test, expect, beforeEach, afterAll } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { existsSync, rmSync } from "node:fs";
import {
  fromUsageInfo,
  shouldThrottle,
  selectModel,
  meetsMinModel,
  loadUsageHistory,
  recordUsage,
  DEFAULT_THROTTLE_THRESHOLD,
  MAX_HISTORY_ENTRIES,
} from "../../src/heartbeat/rate-limits.ts";
import type { RateLimitStatus } from "../../src/heartbeat/rate-limits.ts";
import type { UsageInfo } from "../../src/api/types.ts";

// ---------------------------------------------------------------------------
// Test Setup
// ---------------------------------------------------------------------------

const TEST_MIND = join(tmpdir(), `jarvis-test-rate-limits-${Date.now()}`);

function makeStatus(fiveHour: number, sevenDay: number): RateLimitStatus {
  return {
    fiveHour,
    sevenDay,
    fiveHourResetsAt: "2026-02-21T20:00:00Z",
    sevenDayResetsAt: "2026-02-28T00:00:00Z",
    checkedAt: new Date().toISOString(),
  };
}

beforeEach(() => {
  if (existsSync(TEST_MIND)) {
    rmSync(TEST_MIND, { recursive: true });
  }
});

afterAll(() => {
  if (existsSync(TEST_MIND)) {
    rmSync(TEST_MIND, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// fromUsageInfo
// ---------------------------------------------------------------------------

describe("fromUsageInfo", () => {
  test("converts API UsageInfo to RateLimitStatus", () => {
    const usage: UsageInfo = {
      five_hour: { utilization: 0.42, resets_at: "2026-02-21T20:00:00Z" },
      seven_day: { utilization: 0.15, resets_at: "2026-02-28T00:00:00Z" },
    };

    const status = fromUsageInfo(usage);

    expect(status.fiveHour).toBe(0.42);
    expect(status.sevenDay).toBe(0.15);
    expect(status.fiveHourResetsAt).toBe("2026-02-21T20:00:00Z");
    expect(status.sevenDayResetsAt).toBe("2026-02-28T00:00:00Z");
    expect(status.checkedAt).toBeTruthy();
  });

  test("handles zero utilization", () => {
    const usage: UsageInfo = {
      five_hour: { utilization: 0, resets_at: "2026-02-21T20:00:00Z" },
      seven_day: { utilization: 0, resets_at: "2026-02-28T00:00:00Z" },
    };

    const status = fromUsageInfo(usage);
    expect(status.fiveHour).toBe(0);
    expect(status.sevenDay).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// shouldThrottle
// ---------------------------------------------------------------------------

describe("shouldThrottle", () => {
  test("returns false when both windows are below threshold", () => {
    const status = makeStatus(0.3, 0.2);
    expect(shouldThrottle(status)).toBe(false);
  });

  test("returns true when 5-hour exceeds threshold", () => {
    const status = makeStatus(0.85, 0.2);
    expect(shouldThrottle(status)).toBe(true);
  });

  test("returns true when 7-day exceeds threshold", () => {
    const status = makeStatus(0.2, 0.9);
    expect(shouldThrottle(status)).toBe(true);
  });

  test("returns true when both exceed threshold", () => {
    const status = makeStatus(0.85, 0.95);
    expect(shouldThrottle(status)).toBe(true);
  });

  test("uses custom threshold when provided", () => {
    const status = makeStatus(0.55, 0.4);
    expect(shouldThrottle(status, 0.5)).toBe(true);
    expect(shouldThrottle(status, 0.6)).toBe(false);
  });

  test("returns true at exactly the threshold", () => {
    const status = makeStatus(DEFAULT_THROTTLE_THRESHOLD, 0.0);
    expect(shouldThrottle(status)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// selectModel
// ---------------------------------------------------------------------------

describe("selectModel", () => {
  test("returns preferred model when utilization is low", () => {
    const status = makeStatus(0.1, 0.2);
    expect(selectModel(status, "claude-opus-4-6")).toBe("claude-opus-4-6");
  });

  test("downgrades opus to sonnet at moderate utilization", () => {
    const status = makeStatus(0.6, 0.3);
    expect(selectModel(status, "claude-opus-4-6")).toBe("claude-sonnet-4-6");
  });

  test("downgrades opus to haiku at high utilization", () => {
    const status = makeStatus(0.85, 0.3);
    expect(selectModel(status, "claude-opus-4-6")).toBe("claude-haiku-4-5-20251001");
  });

  test("downgrades sonnet to haiku at high utilization", () => {
    const status = makeStatus(0.9, 0.3);
    expect(selectModel(status, "claude-sonnet-4-6")).toBe("claude-haiku-4-5-20251001");
  });

  test("returns haiku unchanged regardless of utilization", () => {
    const status = makeStatus(0.95, 0.95);
    expect(selectModel(status, "claude-haiku-4-5-20251001")).toBe("claude-haiku-4-5-20251001");
  });

  test("returns unknown model unchanged", () => {
    const status = makeStatus(0.9, 0.9);
    expect(selectModel(status, "custom-model")).toBe("custom-model");
  });

  test("uses max of both windows for decision", () => {
    // 5-hour is low but 7-day is high
    const status = makeStatus(0.2, 0.85);
    expect(selectModel(status, "claude-opus-4-6")).toBe("claude-haiku-4-5-20251001");
  });

  test("threshold at exactly 0.5 downgrades one tier", () => {
    const status = makeStatus(0.5, 0.0);
    expect(selectModel(status, "claude-opus-4-6")).toBe("claude-sonnet-4-6");
  });

  test("threshold at exactly 0.8 downgrades to cheapest", () => {
    const status = makeStatus(0.8, 0.0);
    expect(selectModel(status, "claude-opus-4-6")).toBe("claude-haiku-4-5-20251001");
  });
});

// ---------------------------------------------------------------------------
// meetsMinModel
// ---------------------------------------------------------------------------

describe("meetsMinModel", () => {
  test("returns true when no minimum is specified", () => {
    expect(meetsMinModel("claude-haiku-4-5-20251001")).toBe(true);
    expect(meetsMinModel("claude-haiku-4-5-20251001", undefined)).toBe(true);
  });

  test("returns true when selected model meets the minimum", () => {
    expect(meetsMinModel("claude-opus-4-6", "claude-sonnet-4-6")).toBe(true);
    expect(meetsMinModel("claude-opus-4-6", "claude-opus-4-6")).toBe(true);
    expect(meetsMinModel("claude-sonnet-4-6", "claude-sonnet-4-6")).toBe(true);
    expect(meetsMinModel("claude-sonnet-4-6", "claude-haiku-4-5-20251001")).toBe(true);
  });

  test("returns false when selected model is below minimum", () => {
    expect(meetsMinModel("claude-haiku-4-5-20251001", "claude-sonnet-4-6")).toBe(false);
    expect(meetsMinModel("claude-haiku-4-5-20251001", "claude-opus-4-6")).toBe(false);
    expect(meetsMinModel("claude-sonnet-4-6", "claude-opus-4-6")).toBe(false);
  });

  test("returns true for unknown selected model (fail open)", () => {
    expect(meetsMinModel("custom-model", "claude-sonnet-4-6")).toBe(true);
  });

  test("returns true for unknown minimum model (fail open)", () => {
    expect(meetsMinModel("claude-haiku-4-5-20251001", "custom-min")).toBe(true);
  });

  test("returns true when both models are unknown (fail open)", () => {
    expect(meetsMinModel("model-a", "model-b")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Usage History Persistence
// ---------------------------------------------------------------------------

describe("usage history", () => {
  test("loadUsageHistory returns empty array when no file exists", () => {
    const history = loadUsageHistory(TEST_MIND);
    expect(history).toEqual([]);
  });

  test("recordUsage creates file and writes entry", () => {
    const status = makeStatus(0.42, 0.15);
    recordUsage(TEST_MIND, status);

    const history = loadUsageHistory(TEST_MIND);
    expect(history).toHaveLength(1);
    expect(history[0]!.fiveHour).toBe(0.42);
    expect(history[0]!.sevenDay).toBe(0.15);
  });

  test("recordUsage appends to existing history", () => {
    recordUsage(TEST_MIND, makeStatus(0.1, 0.2));
    recordUsage(TEST_MIND, makeStatus(0.3, 0.4));
    recordUsage(TEST_MIND, makeStatus(0.5, 0.6));

    const history = loadUsageHistory(TEST_MIND);
    expect(history).toHaveLength(3);
    expect(history[0]!.fiveHour).toBe(0.1);
    expect(history[2]!.fiveHour).toBe(0.5);
  });

  test("recordUsage trims history to MAX_HISTORY_ENTRIES", () => {
    // Write MAX_HISTORY_ENTRIES + 5 entries
    for (let i = 0; i < MAX_HISTORY_ENTRIES + 5; i++) {
      recordUsage(TEST_MIND, makeStatus(i / 100, i / 200));
    }

    const history = loadUsageHistory(TEST_MIND);
    expect(history).toHaveLength(MAX_HISTORY_ENTRIES);

    // Should keep the most recent entries (oldest dropped)
    expect(history[0]!.fiveHour).toBe(5 / 100);
  });

  test("loadUsageHistory handles corrupted file gracefully", () => {
    const path = join(TEST_MIND, "heartbeat", "usage-history.json");
    const { mkdirSync, writeFileSync } = require("node:fs");
    mkdirSync(join(TEST_MIND, "heartbeat"), { recursive: true });
    writeFileSync(path, "not valid json{{");

    const history = loadUsageHistory(TEST_MIND);
    expect(history).toEqual([]);
  });

  test("recordUsage creates heartbeat directory if missing", () => {
    const hbDir = join(TEST_MIND, "heartbeat");
    expect(existsSync(hbDir)).toBe(false);

    recordUsage(TEST_MIND, makeStatus(0.1, 0.2));
    expect(existsSync(hbDir)).toBe(true);
  });
});
