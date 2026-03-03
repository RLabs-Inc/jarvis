// ---------------------------------------------------------------------------
// Tests — Telegram Notification from Autonomous Tasks
// ---------------------------------------------------------------------------

import { describe, it, expect } from "bun:test";
import { notifyTelegram, formatWakeNotification } from "../../src/heartbeat/notify.ts";
import type { JarvisConfig } from "../../src/config.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides: Partial<JarvisConfig> = {}): JarvisConfig {
  return {
    authToken: "test-token",
    model: "claude-opus-4-6",
    curationModel: "claude-haiku-4-5-20251001",
    tierBudgets: { tier1: 20000, tier2: 25000, tier3: 15000, tier4: 140000 },
    mindDir: "/tmp/jarvis-test-mind",
    apiBaseUrl: "https://api.anthropic.com",
    sessionTimeoutMs: 30 * 60 * 1000,
    requestTimeoutMs: 30_000,
    telegramToken: "test-bot-token",
    telegramAllowedChats: [12345],
    ...overrides,
  };
}

function mockFetch(responses: Array<{ ok: boolean }>): typeof globalThis.fetch {
  let callIndex = 0;
  const calls: Array<{ url: string; body: unknown }> = [];

  const fn = async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    calls.push({ url, body });

    const responseData = responses[callIndex] ?? { ok: true };
    callIndex++;

    return new Response(JSON.stringify(responseData), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  (fn as any).calls = calls;
  return fn as unknown as typeof globalThis.fetch;
}

// ---------------------------------------------------------------------------
// notifyTelegram
// ---------------------------------------------------------------------------

describe("notifyTelegram", () => {
  it("sends a message to all configured chats", async () => {
    const config = makeConfig({ telegramAllowedChats: [111, 222] });
    const fetch = mockFetch([{ ok: true }, { ok: true }]);

    const result = await notifyTelegram(config, "Hello from Jarvis", { fetchFn: fetch });

    expect(result).toBe(true);
    const calls = (fetch as any).calls;
    expect(calls).toHaveLength(2);
    expect(calls[0].url).toContain("test-bot-token/sendMessage");
    expect(calls[0].body.chat_id).toBe(111);
    expect(calls[0].body.text).toBe("Hello from Jarvis");
    expect(calls[1].body.chat_id).toBe(222);
  });

  it("returns false when telegram is not configured", async () => {
    const config = makeConfig({ telegramToken: undefined });
    const result = await notifyTelegram(config, "Hello");
    expect(result).toBe(false);
  });

  it("returns false when no allowed chats", async () => {
    const config = makeConfig({ telegramAllowedChats: [] });
    const result = await notifyTelegram(config, "Hello");
    expect(result).toBe(false);
  });

  it("returns true if at least one chat succeeds", async () => {
    const config = makeConfig({ telegramAllowedChats: [111, 222] });
    const fetch = mockFetch([{ ok: false }, { ok: true }]);

    const result = await notifyTelegram(config, "Hello", { fetchFn: fetch });
    expect(result).toBe(true);
  });

  it("returns false if all chats fail", async () => {
    const config = makeConfig({ telegramAllowedChats: [111] });
    const fetch = mockFetch([{ ok: false }]);

    const result = await notifyTelegram(config, "Hello", { fetchFn: fetch });
    expect(result).toBe(false);
  });

  it("handles fetch exceptions gracefully", async () => {
    const config = makeConfig();
    const fetch = (async () => { throw new Error("network error"); }) as unknown as typeof globalThis.fetch;

    const result = await notifyTelegram(config, "Hello", { fetchFn: fetch });
    expect(result).toBe(false);
  });

  it("truncates messages longer than 4096 chars", async () => {
    const config = makeConfig();
    const fetch = mockFetch([{ ok: true }]);
    const longMessage = "x".repeat(5000);

    await notifyTelegram(config, longMessage, { fetchFn: fetch });

    const calls = (fetch as any).calls;
    expect(calls[0].body.text.length).toBe(4096);
  });
});

// ---------------------------------------------------------------------------
// formatWakeNotification
// ---------------------------------------------------------------------------

describe("formatWakeNotification", () => {
  it("formats a successful task", () => {
    const msg = formatWakeNotification(
      "daily_reflection",
      true,
      false,
      "I read Hacker News and wrote about intermediaries.",
      45000,
    );

    expect(msg).toContain("✅");
    expect(msg).toContain("daily_reflection");
    expect(msg).toContain("45s");
    expect(msg).toContain("I read Hacker News");
  });

  it("formats a throttled task", () => {
    const msg = formatWakeNotification(
      "daily_reflection",
      true,
      true,
      "Deferred: utilization too high",
      500,
    );

    expect(msg).toContain("⏸️");
    expect(msg).toContain("deferred");
    expect(msg).toContain("rate limits");
  });

  it("formats a failed task", () => {
    const msg = formatWakeNotification(
      "daily_reflection",
      false,
      false,
      "",
      2000,
      "API timeout after 30s",
    );

    expect(msg).toContain("❌");
    expect(msg).toContain("failed");
    expect(msg).toContain("API timeout");
  });

  it("formats duration in minutes", () => {
    const msg = formatWakeNotification("daily_reflection", true, false, "Done.", 125000);
    expect(msg).toContain("2m 5s");
  });

  it("formats duration in hours", () => {
    const msg = formatWakeNotification("daily_reflection", true, false, "Done.", 3700000);
    expect(msg).toContain("1h 1m");
  });

  it("shows (no output) for empty response", () => {
    const msg = formatWakeNotification("daily_reflection", true, false, "", 5000);
    expect(msg).toContain("(no output)");
  });

  it("truncates very long responses", () => {
    const longResponse = "Line\n\n".repeat(2000);
    const msg = formatWakeNotification("daily_reflection", true, false, longResponse, 5000);
    expect(msg.length).toBeLessThan(4100); // fits in one Telegram message
  });

  it("truncates long error messages", () => {
    const longError = "x".repeat(500);
    const msg = formatWakeNotification("test", false, false, "", 1000, longError);
    expect(msg.length).toBeLessThan(300);
  });
});
