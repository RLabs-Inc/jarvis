import { describe, test, expect } from "bun:test";
import {
  buildDefaultSchedule,
  extractTaskName,
} from "../../src/heartbeat/cron.ts";

// ---------------------------------------------------------------------------
// Heartbeat Cron Tests
// ---------------------------------------------------------------------------
//
// We test the pure functions (buildDefaultSchedule, extractTaskName).
// The async functions (installDefaultSchedule, getSchedule, updateSchedule)
// call the live crontab, so we test their logic through the pure functions
// and the existing tools/cron.ts tests.
// ---------------------------------------------------------------------------

describe("buildDefaultSchedule", () => {
  test("returns 3 default entries", () => {
    const schedule = buildDefaultSchedule();
    expect(schedule).toHaveLength(3);
  });

  test("includes morning_routine at 7 AM daily", () => {
    const schedule = buildDefaultSchedule();
    const morning = schedule.find((e) => e.id === "morning_routine");
    expect(morning).toBeDefined();
    expect(morning!.schedule).toBe("0 7 * * *");
    expect(morning!.task).toBe("morning_routine");
  });

  test("includes check_rate_limits every 6 hours", () => {
    const schedule = buildDefaultSchedule();
    const check = schedule.find((e) => e.id === "check_rate_limits");
    expect(check).toBeDefined();
    expect(check!.schedule).toBe("0 */6 * * *");
    expect(check!.task).toBe("check_rate_limits");
  });

  test("includes weekly_review on Sundays at 2 AM", () => {
    const schedule = buildDefaultSchedule();
    const weekly = schedule.find((e) => e.id === "weekly_review");
    expect(weekly).toBeDefined();
    expect(weekly!.schedule).toBe("0 2 * * 0");
    expect(weekly!.task).toBe("weekly_review");
  });

  test("schedule entries have task field (path handled by toCronEntry)", () => {
    const schedule = buildDefaultSchedule();
    // ScheduleEntries contain task names, not full commands
    expect(schedule[0]!.task).toBe("morning_routine");
    expect(schedule.every((e) => e.task && e.schedule && e.id)).toBe(true);
  });
});

describe("extractTaskName", () => {
  test("extracts task name from standard command", () => {
    expect(extractTaskName("/home/jarvis/daemon wake --task morning_routine")).toBe("morning_routine");
  });

  test("extracts task name from command with different path", () => {
    expect(extractTaskName("/usr/local/bin/jarvis wake --task check_rate_limits")).toBe("check_rate_limits");
  });

  test("extracts task name with extra whitespace", () => {
    expect(extractTaskName("/home/jarvis/daemon wake  --task  weekly_review")).toBe("weekly_review");
  });

  test("returns null for command without wake --task pattern", () => {
    expect(extractTaskName("/usr/bin/logrotate")).toBeNull();
  });

  test("returns null for empty string", () => {
    expect(extractTaskName("")).toBeNull();
  });

  test("returns null for partial match", () => {
    expect(extractTaskName("/home/jarvis/daemon wake")).toBeNull();
    expect(extractTaskName("/home/jarvis/daemon --task foo")).toBeNull();
  });
});
