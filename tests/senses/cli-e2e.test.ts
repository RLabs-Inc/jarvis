import { describe, test, expect } from "bun:test";
import {
  formatTierReport,
  formatStats,
  formatToolCall,
  formatToolResult,
  formatError,
} from "../../src/senses/cli.ts";
import type { ConversationEvent, TextDeltaEvent } from "../../src/conversation.ts";
import type { TierBudgetReport } from "../../src/context/types.ts";
import type { TierNum } from "../../src/context/types.ts";

// ---------------------------------------------------------------------------
// Helper: Simulate the same rendering logic the CLI uses
// ---------------------------------------------------------------------------

function renderEvents(events: ConversationEvent[]): string {
  let output = "";
  const write = (text: string) => { output += text; };
  const writeln = (text: string) => { output += text + "\n"; };

  for (const event of events) {
    switch (event.type) {
      case "text_delta":
        write(event.text);
        break;
      case "tool_call":
        writeln("");
        writeln(formatToolCall(event.toolName, event.input));
        break;
      case "tool_result":
        writeln(formatToolResult(event.content, event.isError));
        break;
      case "turn_complete":
        writeln("");
        writeln(
          `[tokens] in: ${event.usage.inputTokens.toLocaleString()}, ` +
          `out: ${event.usage.outputTokens.toLocaleString()}, ` +
          `cache: ${event.usage.cacheReadTokens.toLocaleString()} read / ${event.usage.cacheCreationTokens.toLocaleString()} write`,
        );
        break;
      case "error":
        writeln(formatError(event.error, event.recoverable));
        break;
    }
  }

  return output;
}

// ---------------------------------------------------------------------------
// Streaming Output Accumulation
// ---------------------------------------------------------------------------

describe("streaming output rendering", () => {
  test("renders text deltas concatenated", () => {
    const events: TextDeltaEvent[] = [
      { type: "text_delta", text: "Hello" },
      { type: "text_delta", text: ", " },
      { type: "text_delta", text: "World!" },
    ];

    const output = renderEvents(events);
    expect(output).toBe("Hello, World!");
  });

  test("renders tool call with compact summary", () => {
    const events: ConversationEvent[] = [
      { type: "tool_call", toolName: "bash", toolId: "tc_1", input: { command: "echo hello" } },
    ];

    const output = renderEvents(events);
    expect(output).toContain("[tool] bash: echo hello");
  });

  test("renders tool result", () => {
    const events: ConversationEvent[] = [
      { type: "tool_result", toolId: "tc_1", content: "hello\n", isError: false },
    ];

    const output = renderEvents(events);
    expect(output).toContain("[tool result] hello");
  });

  test("renders error tool result", () => {
    const events: ConversationEvent[] = [
      { type: "tool_result", toolId: "tc_1", content: "command not found", isError: true },
    ];

    const output = renderEvents(events);
    expect(output).toContain("[tool error] command not found");
  });

  test("renders full conversation with tool use", () => {
    const events: ConversationEvent[] = [
      { type: "text_delta", text: "Let me check..." },
      { type: "tool_call", toolName: "bash", toolId: "tc_1", input: { command: "date" } },
      { type: "tool_result", toolId: "tc_1", content: "Sat Feb 21", isError: false },
      { type: "text_delta", text: "It's Saturday!" },
      {
        type: "turn_complete",
        stopReason: "end_turn",
        usage: { inputTokens: 1000, outputTokens: 50, cacheCreationTokens: 0, cacheReadTokens: 800 },
      },
    ];

    const output = renderEvents(events);
    expect(output).toContain("Let me check...");
    expect(output).toContain("[tool] bash: date");
    expect(output).toContain("[tool result] Sat Feb 21");
    expect(output).toContain("It's Saturday!");
    expect(output).toContain("[tokens]");
    expect(output).toContain("1,000");
    expect(output).toContain("800 read");
  });

  test("renders turn_complete with token usage", () => {
    const events: ConversationEvent[] = [
      {
        type: "turn_complete",
        stopReason: "end_turn",
        usage: { inputTokens: 20000, outputTokens: 500, cacheCreationTokens: 15000, cacheReadTokens: 18000 },
      },
    ];

    const output = renderEvents(events);
    expect(output).toContain("in: 20,000");
    expect(output).toContain("out: 500");
    expect(output).toContain("18,000 read");
    expect(output).toContain("15,000 write");
  });

  test("renders recoverable error as warning", () => {
    const events: ConversationEvent[] = [
      { type: "error", error: new Error("Rate limit hit"), recoverable: true },
    ];

    const output = renderEvents(events);
    expect(output).toContain("[warning]");
    expect(output).toContain("Rate limit hit");
    expect(output).toContain("will retry");
  });

  test("renders non-recoverable error", () => {
    const events: ConversationEvent[] = [
      { type: "error", error: new Error("Auth failed"), recoverable: false },
    ];

    const output = renderEvents(events);
    expect(output).toContain("[error]");
    expect(output).toContain("Auth failed");
    expect(output).not.toContain("will retry");
  });
});

// ---------------------------------------------------------------------------
// Tier Report Display
// ---------------------------------------------------------------------------

describe("tier report display", () => {
  test("empty tiers show zero tokens", () => {
    const report: TierBudgetReport = {
      tiers: [
        { tier: 1 as TierNum, tokens: 0, budget: 20_000, status: "ok", overage: 0 },
        { tier: 2 as TierNum, tokens: 0, budget: 25_000, status: "ok", overage: 0 },
        { tier: 3 as TierNum, tokens: 0, budget: 15_000, status: "ok", overage: 0 },
        { tier: 4 as TierNum, tokens: 0, budget: 140_000, status: "ok", overage: 0 },
      ],
      totalTokens: 0,
      totalBudget: 200_000,
      allWithinBudget: true,
    };

    const formatted = formatTierReport(report);
    expect(formatted).toContain("0/20,000");
    expect(formatted).toContain("0.0%");
    expect(formatted).not.toContain("[OVER]");
  });

  test("full tier shows 100%", () => {
    const report: TierBudgetReport = {
      tiers: [
        { tier: 1 as TierNum, tokens: 20_000, budget: 20_000, status: "ok", overage: 0 },
        { tier: 2 as TierNum, tokens: 0, budget: 25_000, status: "ok", overage: 0 },
        { tier: 3 as TierNum, tokens: 0, budget: 15_000, status: "ok", overage: 0 },
        { tier: 4 as TierNum, tokens: 0, budget: 140_000, status: "ok", overage: 0 },
      ],
      totalTokens: 20_000,
      totalBudget: 200_000,
      allWithinBudget: true,
    };

    const formatted = formatTierReport(report);
    expect(formatted).toContain("100.0%");
  });
});

// ---------------------------------------------------------------------------
// Status Display
// ---------------------------------------------------------------------------

describe("status display", () => {
  test("shows all status fields", () => {
    const stats = {
      status: "running" as const,
      sessionId: "test-session-id",
      messageCount: 12,
      uptime: 3_600_000, // 1 hour
    };

    const formatted = formatStats(stats);
    expect(formatted).toContain("running");
    expect(formatted).toContain("test-session-id");
    expect(formatted).toContain("12");
    expect(formatted).toContain("1h 0m");
  });

  test("handles zero uptime", () => {
    const stats = {
      status: "idle" as const,
      sessionId: null,
      messageCount: 0,
      uptime: 0,
    };

    const formatted = formatStats(stats);
    expect(formatted).toContain("0s");
  });

  test("shows seconds for short uptimes", () => {
    const stats = {
      status: "running" as const,
      sessionId: null,
      messageCount: 0,
      uptime: 45_000,
    };

    const formatted = formatStats(stats);
    expect(formatted).toContain("45s");
  });
});
