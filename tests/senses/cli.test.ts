import { describe, test, expect } from "bun:test";
import {
  parseCommand,
  formatTierReport,
  formatStats,
  formatToolCall,
  formatToolResult,
  formatError,
  SLASH_COMMANDS,
} from "../../src/senses/cli.ts";
import type { TierBudgetReport } from "../../src/context/types.ts";
import type { DaemonStats } from "../../src/daemon.ts";

// ---------------------------------------------------------------------------
// parseCommand
// ---------------------------------------------------------------------------

describe("parseCommand", () => {
  test("returns null for plain text", () => {
    expect(parseCommand("hello world")).toBeNull();
    expect(parseCommand("what time is it?")).toBeNull();
    expect(parseCommand("")).toBeNull();
    expect(parseCommand("  ")).toBeNull();
  });

  test("parses known slash commands", () => {
    expect(parseCommand("/quit")).toEqual({ command: "/quit", args: "" });
    expect(parseCommand("/status")).toEqual({ command: "/status", args: "" });
    expect(parseCommand("/session")).toEqual({ command: "/session", args: "" });
    expect(parseCommand("/tiers")).toEqual({ command: "/tiers", args: "" });
    expect(parseCommand("/help")).toEqual({ command: "/help", args: "" });
  });

  test("handles leading/trailing whitespace", () => {
    expect(parseCommand("  /quit  ")).toEqual({ command: "/quit", args: "" });
    expect(parseCommand("  /status  ")).toEqual({ command: "/status", args: "" });
  });

  test("is case insensitive", () => {
    expect(parseCommand("/QUIT")).toEqual({ command: "/quit", args: "" });
    expect(parseCommand("/Status")).toEqual({ command: "/status", args: "" });
  });

  test("returns null for unknown slash commands", () => {
    expect(parseCommand("/unknown")).toBeNull();
    expect(parseCommand("/exit")).toBeNull();
    expect(parseCommand("/clear")).toBeNull();
  });

  test("parses args after command", () => {
    expect(parseCommand("/quit now")).toEqual({ command: "/quit", args: "now" });
    expect(parseCommand("/status verbose")).toEqual({ command: "/status", args: "verbose" });
  });

  test("SLASH_COMMANDS contains all expected commands", () => {
    expect(SLASH_COMMANDS).toContain("/quit");
    expect(SLASH_COMMANDS).toContain("/status");
    expect(SLASH_COMMANDS).toContain("/session");
    expect(SLASH_COMMANDS).toContain("/tiers");
    expect(SLASH_COMMANDS).toContain("/help");
    expect(SLASH_COMMANDS.length).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// formatTierReport
// ---------------------------------------------------------------------------

describe("formatTierReport", () => {
  const report: TierBudgetReport = {
    tiers: [
      { tier: 1, tokens: 10_000, budget: 20_000, status: "ok", overage: 0 },
      { tier: 2, tokens: 25_000, budget: 25_000, status: "ok", overage: 0 },
      { tier: 3, tokens: 18_000, budget: 15_000, status: "over_budget", overage: 3_000 },
      { tier: 4, tokens: 0, budget: 140_000, status: "ok", overage: 0 },
    ],
    totalTokens: 53_000,
    totalBudget: 200_000,
    allWithinBudget: false,
  };

  test("includes all 4 tiers", () => {
    const formatted = formatTierReport(report);
    expect(formatted).toContain("Tier 1:");
    expect(formatted).toContain("Tier 2:");
    expect(formatted).toContain("Tier 3:");
    expect(formatted).toContain("Tier 4:");
  });

  test("shows OVER marker for over-budget tiers", () => {
    const formatted = formatTierReport(report);
    expect(formatted).toContain("[OVER]");
    // Only Tier 3 is over budget
    const lines = formatted.split("\n");
    const tier3Line = lines.find((l) => l.includes("Tier 3:"));
    expect(tier3Line).toContain("[OVER]");
    // Tier 1 should not have OVER
    const tier1Line = lines.find((l) => l.includes("Tier 1:"));
    expect(tier1Line).not.toContain("[OVER]");
  });

  test("includes total line", () => {
    const formatted = formatTierReport(report);
    expect(formatted).toContain("Total:");
    expect(formatted).toContain("53,000");
    expect(formatted).toContain("200,000");
  });

  test("includes percentage", () => {
    const formatted = formatTierReport(report);
    // Tier 1: 10000/20000 = 50.0%
    expect(formatted).toContain("50.0%");
  });

  test("includes progress bar", () => {
    const formatted = formatTierReport(report);
    expect(formatted).toContain("[");
    expect(formatted).toContain("]");
    expect(formatted).toContain("#");
  });
});

// ---------------------------------------------------------------------------
// formatStats
// ---------------------------------------------------------------------------

describe("formatStats", () => {
  test("formats daemon stats", () => {
    const stats: DaemonStats = {
      status: "running",
      sessionId: "abc-123",
      messageCount: 5,
      uptime: 120_000,
    };

    const formatted = formatStats(stats);
    expect(formatted).toContain("Status: running");
    expect(formatted).toContain("Session: abc-123");
    expect(formatted).toContain("Messages: 5");
    expect(formatted).toContain("Uptime: 2m 0s");
  });

  test("shows 'none' when no session", () => {
    const stats: DaemonStats = {
      status: "idle",
      sessionId: null,
      messageCount: 0,
      uptime: 5_000,
    };

    const formatted = formatStats(stats);
    expect(formatted).toContain("Session: none");
    expect(formatted).toContain("Uptime: 5s");
  });

  test("formats hours for long uptimes", () => {
    const stats: DaemonStats = {
      status: "running",
      sessionId: null,
      messageCount: 0,
      uptime: 7_200_000 + 1_800_000, // 2h 30m
    };

    const formatted = formatStats(stats);
    expect(formatted).toContain("2h 30m");
  });
});

// ---------------------------------------------------------------------------
// formatToolCall
// ---------------------------------------------------------------------------

describe("formatToolCall", () => {
  test("formats bash with command", () => {
    const result = formatToolCall("bash", { command: "ls -la /home" });
    expect(result).toContain("[tool] bash");
    expect(result).toContain("ls -la /home");
  });

  test("truncates long bash commands", () => {
    const longCmd = "a".repeat(100);
    const result = formatToolCall("bash", { command: longCmd });
    expect(result).toContain("...");
    expect(result.length).toBeLessThan(120);
  });

  test("formats read_file with path", () => {
    const result = formatToolCall("read_file", { path: "/home/jarvis/mind/tier1/identity.md" });
    expect(result).toContain("[tool] read_file");
    expect(result).toContain("/home/jarvis/mind/tier1/identity.md");
  });

  test("formats write_file with path", () => {
    const result = formatToolCall("write_file", { path: "/tmp/test.txt", content: "hello" });
    expect(result).toContain("[tool] write_file");
    expect(result).toContain("/tmp/test.txt");
  });

  test("formats ssh_exec with host and command", () => {
    const result = formatToolCall("ssh_exec", { host: "macmini", command: "uptime" });
    expect(result).toContain("[tool] ssh_exec");
    expect(result).toContain("macmini");
    expect(result).toContain("uptime");
  });

  test("formats web_fetch with URL", () => {
    const result = formatToolCall("web_fetch", { url: "https://example.com" });
    expect(result).toContain("[tool] web_fetch");
    expect(result).toContain("https://example.com");
  });

  test("formats cron_manage with action", () => {
    const result = formatToolCall("cron_manage", { action: "list" });
    expect(result).toContain("[tool] cron_manage");
    expect(result).toContain("list");
  });

  test("handles unknown tool gracefully", () => {
    const result = formatToolCall("unknown_tool", { foo: "bar" });
    expect(result).toContain("[tool] unknown_tool");
  });
});

// ---------------------------------------------------------------------------
// formatToolResult
// ---------------------------------------------------------------------------

describe("formatToolResult", () => {
  test("formats success result", () => {
    const result = formatToolResult("file written successfully", false);
    expect(result).toContain("[tool result]");
    expect(result).toContain("file written successfully");
  });

  test("formats error result", () => {
    const result = formatToolResult("permission denied", true);
    expect(result).toContain("[tool error]");
    expect(result).toContain("permission denied");
  });

  test("truncates long results", () => {
    const long = "x".repeat(300);
    const result = formatToolResult(long, false);
    expect(result).toContain("...");
    expect(result.length).toBeLessThan(250);
  });
});

// ---------------------------------------------------------------------------
// formatError
// ---------------------------------------------------------------------------

describe("formatError", () => {
  test("formats recoverable error as warning", () => {
    const result = formatError(new Error("Rate limit exceeded"), true);
    expect(result).toContain("[warning]");
    expect(result).toContain("Rate limit exceeded");
    expect(result).toContain("will retry");
  });

  test("formats non-recoverable error", () => {
    const result = formatError(new Error("Authentication failed"), false);
    expect(result).toContain("[error]");
    expect(result).toContain("Authentication failed");
    expect(result).not.toContain("will retry");
  });
});
