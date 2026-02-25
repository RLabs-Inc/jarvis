import { describe, test, expect } from "bun:test";
import { parseCrontab, serializeCrontab, type CronEntry } from "../../src/tools/cron.ts";

// ---------------------------------------------------------------------------
// Crontab Parse / Serialize Tests
// ---------------------------------------------------------------------------
//
// We test the pure parse/serialize functions thoroughly.
// The actual cronList/cronAdd/cronRemove hit the real crontab, so we test
// those through the parse/serialize layer to avoid modifying the host crontab.
// ---------------------------------------------------------------------------

describe("parseCrontab", () => {
  test("parses jarvis-tagged entries", () => {
    const raw = `0 7 * * * /home/jarvis/daemon wake --task morning # jarvis:morning\n`;
    const { jarvis, other } = parseCrontab(raw);

    expect(jarvis).toHaveLength(1);
    expect(jarvis[0]!.id).toBe("morning");
    expect(jarvis[0]!.schedule).toBe("0 7 * * *");
    expect(jarvis[0]!.command).toBe("/home/jarvis/daemon wake --task morning");
    expect(other).toHaveLength(0);
  });

  test("separates jarvis entries from other entries", () => {
    const raw = [
      "# system crontab",
      "0 * * * * /usr/bin/logrotate",
      "0 7 * * * /home/jarvis/wake # jarvis:morning",
      "*/5 * * * * /home/jarvis/heartbeat # jarvis:heartbeat",
    ].join("\n");

    const { jarvis, other } = parseCrontab(raw);
    expect(jarvis).toHaveLength(2);
    expect(other).toHaveLength(2);
    expect(other[0]).toBe("# system crontab");
    expect(other[1]).toBe("0 * * * * /usr/bin/logrotate");
  });

  test("handles empty crontab", () => {
    const { jarvis, other } = parseCrontab("");
    expect(jarvis).toHaveLength(0);
    expect(other).toHaveLength(0);
  });

  test("handles crontab with only comments", () => {
    const raw = "# comment 1\n# comment 2\n";
    const { jarvis, other } = parseCrontab(raw);
    expect(jarvis).toHaveLength(0);
    expect(other).toHaveLength(2);
  });

  test("ignores malformed lines with tag but not enough fields", () => {
    const raw = "bad line # jarvis:test\n";
    const { jarvis, other } = parseCrontab(raw);
    expect(jarvis).toHaveLength(0);
    expect(other).toHaveLength(1);
  });
});

describe("serializeCrontab", () => {
  test("serializes entries with jarvis tags", () => {
    const jarvis: CronEntry[] = [
      { id: "morning", schedule: "0 7 * * *", command: "/home/jarvis/wake" },
    ];
    const result = serializeCrontab(jarvis, []);
    expect(result).toBe("0 7 * * * /home/jarvis/wake # jarvis:morning\n");
  });

  test("preserves other entries", () => {
    const other = ["# system cron", "0 * * * * /usr/bin/logrotate"];
    const jarvis: CronEntry[] = [
      { id: "hb", schedule: "*/5 * * * *", command: "/home/jarvis/heartbeat" },
    ];
    const result = serializeCrontab(jarvis, other);
    expect(result).toContain("# system cron");
    expect(result).toContain("0 * * * * /usr/bin/logrotate");
    expect(result).toContain("# jarvis:hb");
    expect(result.endsWith("\n")).toBe(true);
  });

  test("roundtrip: parse → serialize preserves jarvis entries", () => {
    const original = [
      "# system",
      "0 7 * * * /home/jarvis/wake # jarvis:morning",
      "*/5 * * * * /home/jarvis/hb # jarvis:heartbeat",
    ].join("\n") + "\n";

    const { jarvis, other } = parseCrontab(original);
    const result = serializeCrontab(jarvis, other);

    // Re-parse to verify
    const { jarvis: jarvis2 } = parseCrontab(result);
    expect(jarvis2).toHaveLength(2);
    expect(jarvis2[0]!.id).toBe("morning");
    expect(jarvis2[1]!.id).toBe("heartbeat");
  });
});
