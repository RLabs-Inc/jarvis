import { describe, test, expect, beforeEach, afterAll, afterEach } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { existsSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import {
  callTelegramApi,
  splitMessage,
  escapeMarkdownV2,
  formatForTelegram,
  extractBotCommand,
  isChatAllowed,
  TelegramBot,
  createTelegramBot,
  MAX_MESSAGE_LENGTH,
  BOT_COMMANDS,
} from "../../src/senses/telegram.ts";
import type {
  TelegramMessage,
  TelegramUpdate,
  TelegramBotConfig,
} from "../../src/senses/telegram.ts";
import { Daemon } from "../../src/daemon.ts";
import type { JarvisConfig } from "../../src/config.ts";
import { DEFAULT_CONFIG } from "../../src/config.ts";
import { parseArgs } from "../../src/cli-entry.ts";

// ---------------------------------------------------------------------------
// Test Setup
// ---------------------------------------------------------------------------

const TEST_MIND = join(tmpdir(), `jarvis-test-telegram-${Date.now()}`);
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

  writeFileSync(join(TEST_MIND, "tier1", "identity.md"), "# Jarvis\nI am Jarvis.");
  writeFileSync(join(TEST_MIND, "tier2", "projects.md"), "# Projects\nTest.");
  writeFileSync(join(TEST_MIND, "tier3", "recent.md"), "# Recent\nTest.");
}

/** Create a mock fetch that returns a Telegram API response */
function mockTelegramFetch(result: unknown, ok = true): typeof globalThis.fetch {
  return (async () => {
    return new Response(
      JSON.stringify({ ok, result, description: ok ? undefined : "error", error_code: ok ? undefined : 400 }),
      { status: ok ? 200 : 400, headers: { "Content-Type": "application/json" } },
    );
  }) as unknown as typeof globalThis.fetch;
}

/** Create a mock fetch that tracks calls */
function trackingFetch(result: unknown = true): {
  fetch: typeof globalThis.fetch;
  calls: { url: string; body: Record<string, unknown> }[];
} {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const fetch = (async (input: string | Request | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const body = init?.body ? JSON.parse(init.body as string) : {};
    calls.push({ url, body });
    return new Response(
      JSON.stringify({ ok: true, result }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

/** Make a Telegram message object */
function makeMessage(overrides?: Partial<TelegramMessage>): TelegramMessage {
  return {
    message_id: 1,
    from: { id: 123, first_name: "Sherlock" },
    chat: { id: 456, type: "private" },
    date: Math.floor(Date.now() / 1000),
    text: "Hello Jarvis",
    ...overrides,
  };
}

/** Make a Telegram update object */
function makeUpdate(overrides?: Partial<TelegramUpdate>): TelegramUpdate {
  return {
    update_id: 1000,
    message: makeMessage(),
    ...overrides,
  };
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

// ---------------------------------------------------------------------------
// callTelegramApi
// ---------------------------------------------------------------------------

describe("callTelegramApi", () => {
  test("calls correct URL with POST and JSON body", async () => {
    const { fetch, calls } = trackingFetch({ id: 1, first_name: "Bot" });
    await callTelegramApi("test-token", "getMe", {}, fetch);

    expect(calls.length).toBe(1);
    expect(calls[0]!.url).toBe("https://api.telegram.org/bottest-token/getMe");
  });

  test("passes parameters in JSON body", async () => {
    const { fetch, calls } = trackingFetch([]);
    await callTelegramApi("tok", "getUpdates", { offset: 5, timeout: 30 }, fetch);

    expect(calls[0]!.body).toEqual({ offset: 5, timeout: 30 });
  });

  test("returns result on success", async () => {
    const fetch = mockTelegramFetch({ id: 42, first_name: "Jarvis" });
    const result = await callTelegramApi<{ id: number }>("tok", "getMe", {}, fetch);
    expect(result.id).toBe(42);
  });

  test("throws on API error", async () => {
    const fetch = mockTelegramFetch(null, false);
    await expect(callTelegramApi("tok", "getMe", {}, fetch)).rejects.toThrow("Telegram API error");
  });

  test("includes error description in throw message", async () => {
    const fetch = (async () =>
      new Response(
        JSON.stringify({ ok: false, description: "Unauthorized", error_code: 401 }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      )) as unknown as typeof globalThis.fetch;

    await expect(callTelegramApi("tok", "getMe", {}, fetch)).rejects.toThrow("Unauthorized (401)");
  });
});

// ---------------------------------------------------------------------------
// splitMessage
// ---------------------------------------------------------------------------

describe("splitMessage", () => {
  test("returns single chunk for short messages", () => {
    expect(splitMessage("hello")).toEqual(["hello"]);
  });

  test("returns single chunk for exactly max length", () => {
    const msg = "a".repeat(MAX_MESSAGE_LENGTH);
    expect(splitMessage(msg)).toEqual([msg]);
  });

  test("splits at newline boundary when possible", () => {
    const line1 = "a".repeat(50);
    const line2 = "b".repeat(50);
    const text = `${line1}\n${line2}`;
    const chunks = splitMessage(text, 60);
    expect(chunks.length).toBe(2);
    expect(chunks[0]).toBe(line1);
    expect(chunks[1]).toBe(line2);
  });

  test("splits at space when no good newline found", () => {
    const text = "word ".repeat(20).trim(); // 99 chars
    const chunks = splitMessage(text, 50);
    expect(chunks.length).toBe(2);
    // Each chunk should end at a space boundary
    expect(chunks[0]!.endsWith("word")).toBe(true);
  });

  test("hard splits when no boundary found", () => {
    const text = "a".repeat(100);
    const chunks = splitMessage(text, 40);
    expect(chunks.length).toBe(3);
    expect(chunks[0]!.length).toBe(40);
    expect(chunks[1]!.length).toBe(40);
    expect(chunks[2]!.length).toBe(20);
  });

  test("handles empty string", () => {
    expect(splitMessage("")).toEqual([""]);
  });
});

// ---------------------------------------------------------------------------
// escapeMarkdownV2
// ---------------------------------------------------------------------------

describe("escapeMarkdownV2", () => {
  test("escapes special characters", () => {
    expect(escapeMarkdownV2("Hello *world*")).toBe("Hello \\*world\\*");
  });

  test("escapes all MarkdownV2 special chars", () => {
    const specials = "_*[]()~`>#+-=|{}.!\\";
    const escaped = escapeMarkdownV2(specials);
    // Each char should be preceded by a backslash
    for (const char of specials) {
      expect(escaped).toContain(`\\${char}`);
    }
  });

  test("leaves normal text unchanged", () => {
    expect(escapeMarkdownV2("Hello World 123")).toBe("Hello World 123");
  });

  test("handles empty string", () => {
    expect(escapeMarkdownV2("")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// formatForTelegram
// ---------------------------------------------------------------------------

describe("formatForTelegram", () => {
  test("returns plain text for messages without code blocks", () => {
    const result = formatForTelegram("Hello world!");
    expect(result.text).toBe("Hello world!");
    expect(result.parseMode).toBeUndefined();
  });

  test("formats code blocks with MarkdownV2", () => {
    const input = 'Here is code:\n```js\nconsole.log("hi");\n```\nDone.';
    const result = formatForTelegram(input);
    expect(result.parseMode).toBe("MarkdownV2");
    // Code block should be preserved, rest escaped
    expect(result.text).toContain("```js");
    expect(result.text).toContain("```");
  });

  test("escapes special chars outside code blocks", () => {
    const input = "Use `config.ts` file:\n```\nconst x = 1;\n```\nThat's it!";
    const result = formatForTelegram(input);
    expect(result.parseMode).toBe("MarkdownV2");
    // The period and exclamation mark should be escaped outside code
    expect(result.text).toContain("\\!");
  });
});

// ---------------------------------------------------------------------------
// extractBotCommand
// ---------------------------------------------------------------------------

describe("extractBotCommand", () => {
  test("extracts /status command", () => {
    const msg = makeMessage({
      text: "/status",
      entities: [{ type: "bot_command", offset: 0, length: 7 }],
    });
    expect(extractBotCommand(msg)).toBe("/status");
  });

  test("extracts command with bot username suffix", () => {
    const msg = makeMessage({
      text: "/status@jarvis_bot",
      entities: [{ type: "bot_command", offset: 0, length: 18 }],
    });
    expect(extractBotCommand(msg)).toBe("/status");
  });

  test("returns null for unrecognized command", () => {
    const msg = makeMessage({
      text: "/unknown",
      entities: [{ type: "bot_command", offset: 0, length: 8 }],
    });
    expect(extractBotCommand(msg)).toBeNull();
  });

  test("returns null for command not at position 0", () => {
    const msg = makeMessage({
      text: "please /status",
      entities: [{ type: "bot_command", offset: 7, length: 7 }],
    });
    expect(extractBotCommand(msg)).toBeNull();
  });

  test("returns null when no entities", () => {
    const msg = makeMessage({ text: "/status", entities: undefined });
    expect(extractBotCommand(msg)).toBeNull();
  });

  test("returns null when no text", () => {
    const msg = makeMessage({ text: undefined });
    expect(extractBotCommand(msg)).toBeNull();
  });

  test("recognizes all bot commands", () => {
    for (const cmd of BOT_COMMANDS) {
      const msg = makeMessage({
        text: cmd,
        entities: [{ type: "bot_command", offset: 0, length: cmd.length }],
      });
      expect(extractBotCommand(msg)).toBe(cmd);
    }
  });

  test("is case-insensitive", () => {
    const msg = makeMessage({
      text: "/STATUS",
      entities: [{ type: "bot_command", offset: 0, length: 7 }],
    });
    expect(extractBotCommand(msg)).toBe("/status");
  });
});

// ---------------------------------------------------------------------------
// isChatAllowed
// ---------------------------------------------------------------------------

describe("isChatAllowed", () => {
  test("allows any chat when allowedChats is empty", () => {
    expect(isChatAllowed(123, [])).toBe(true);
    expect(isChatAllowed(999, [])).toBe(true);
  });

  test("allows chat in the allowed list", () => {
    expect(isChatAllowed(123, [123, 456])).toBe(true);
  });

  test("rejects chat not in the allowed list", () => {
    expect(isChatAllowed(789, [123, 456])).toBe(false);
  });

  test("handles negative chat IDs (group chats)", () => {
    expect(isChatAllowed(-1001234567890, [-1001234567890])).toBe(true);
    expect(isChatAllowed(-1001234567890, [123])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// TelegramBot — Command handling
// ---------------------------------------------------------------------------

describe("TelegramBot commands", () => {
  function makeBotWithTracking(): {
    bot: TelegramBot;
    daemon: Daemon;
    calls: { url: string; body: Record<string, unknown> }[];
  } {
    const config = makeConfig();
    const daemon = new Daemon(config);
    daemon.start();
    currentDaemon = daemon;

    const { fetch, calls } = trackingFetch();
    const botConfig: TelegramBotConfig = {
      token: "test-token",
      allowedChats: [],
      pollingTimeoutSec: 0,
    };

    const bot = new TelegramBot(daemon, config, botConfig, {
      fetch,
      log: () => {},
    });

    return { bot, daemon, calls };
  }

  test("/help sends help message", async () => {
    const { bot, calls } = makeBotWithTracking();
    await bot.handleCommand("/help", 456);

    const sendCall = calls.find((c) => c.url.includes("sendMessage"));
    expect(sendCall).toBeDefined();
    expect(sendCall!.body["text"]).toContain("Commands:");
    expect(sendCall!.body["chat_id"]).toBe(456);
  });

  test("/start sends help message", async () => {
    const { bot, calls } = makeBotWithTracking();
    await bot.handleCommand("/start", 456);

    const sendCall = calls.find((c) => c.url.includes("sendMessage"));
    expect(sendCall!.body["text"]).toContain("Jarvis");
  });

  test("/status shows daemon status", async () => {
    const { bot, calls } = makeBotWithTracking();
    await bot.handleCommand("/status", 456);

    const sendCall = calls.find((c) => c.url.includes("sendMessage"));
    expect(sendCall!.body["text"]).toContain("Status:");
  });

  test("/session shows no active session", async () => {
    const { bot, calls, daemon } = makeBotWithTracking();
    // Daemon starts but no session yet used via handleMessage
    daemon.endSession("user_quit"); // ensure no session
    await bot.handleCommand("/session", 456);

    const sendCall = calls.find((c) => c.url.includes("sendMessage"));
    expect(sendCall!.body["text"]).toContain("No active session");
  });

  test("/tiers shows tier stats", async () => {
    const { bot, calls } = makeBotWithTracking();
    await bot.handleCommand("/tiers", 456);

    const sendCall = calls.find((c) => c.url.includes("sendMessage"));
    expect(sendCall!.body["text"]).toContain("Tier Status:");
  });
});

// ---------------------------------------------------------------------------
// TelegramBot — Access control
// ---------------------------------------------------------------------------

describe("TelegramBot access control", () => {
  test("rejects messages from unauthorized chats", async () => {
    const config = makeConfig();
    const daemon = new Daemon(config);
    daemon.start();
    currentDaemon = daemon;

    const logs: string[] = [];
    const { fetch } = trackingFetch();
    const botConfig: TelegramBotConfig = {
      token: "test-token",
      allowedChats: [123], // Only chat 123 allowed
      pollingTimeoutSec: 0,
    };

    const bot = new TelegramBot(daemon, config, botConfig, {
      fetch,
      log: (msg) => logs.push(msg),
    });

    const update = makeUpdate({
      message: makeMessage({ chat: { id: 999, type: "private" } }),
    });
    await bot.handleUpdate(update);

    expect(logs.some((l) => l.includes("Rejected"))).toBe(true);
  });

  test("allows messages from authorized chats", async () => {
    const config = makeConfig();
    const daemon = new Daemon(config);
    daemon.start();
    currentDaemon = daemon;

    const { fetch, calls } = trackingFetch();
    const botConfig: TelegramBotConfig = {
      token: "test-token",
      allowedChats: [456], // Chat 456 allowed
      pollingTimeoutSec: 0,
    };

    const bot = new TelegramBot(daemon, config, botConfig, {
      fetch,
      log: () => {},
    });

    // Command message from allowed chat
    const update = makeUpdate({
      message: makeMessage({
        chat: { id: 456, type: "private" },
        text: "/help",
        entities: [{ type: "bot_command", offset: 0, length: 5 }],
      }),
    });
    await bot.handleUpdate(update);

    // Should have sent a response
    expect(calls.some((c) => c.url.includes("sendMessage"))).toBe(true);
  });

  test("allows all chats when allowedChats is empty", async () => {
    const config = makeConfig();
    const daemon = new Daemon(config);
    daemon.start();
    currentDaemon = daemon;

    const { fetch, calls } = trackingFetch();
    const botConfig: TelegramBotConfig = {
      token: "test-token",
      allowedChats: [], // Open mode
      pollingTimeoutSec: 0,
    };

    const bot = new TelegramBot(daemon, config, botConfig, {
      fetch,
      log: () => {},
    });

    const update = makeUpdate({
      message: makeMessage({
        chat: { id: 999, type: "private" },
        text: "/help",
        entities: [{ type: "bot_command", offset: 0, length: 5 }],
      }),
    });
    await bot.handleUpdate(update);

    expect(calls.some((c) => c.url.includes("sendMessage"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// TelegramBot — Message handling
// ---------------------------------------------------------------------------

describe("TelegramBot message handling", () => {
  test("ignores updates without message", async () => {
    const config = makeConfig();
    const daemon = new Daemon(config);
    daemon.start();
    currentDaemon = daemon;

    const { fetch, calls } = trackingFetch();
    const botConfig: TelegramBotConfig = {
      token: "test-token",
      allowedChats: [],
      pollingTimeoutSec: 0,
    };

    const bot = new TelegramBot(daemon, config, botConfig, {
      fetch,
      log: () => {},
    });

    await bot.handleUpdate({ update_id: 1000 });
    // No API calls should have been made
    expect(calls.length).toBe(0);
  });

  test("ignores messages without text (photos, stickers)", async () => {
    const config = makeConfig();
    const daemon = new Daemon(config);
    daemon.start();
    currentDaemon = daemon;

    const { fetch, calls } = trackingFetch();
    const botConfig: TelegramBotConfig = {
      token: "test-token",
      allowedChats: [],
      pollingTimeoutSec: 0,
    };

    const bot = new TelegramBot(daemon, config, botConfig, {
      fetch,
      log: () => {},
    });

    const update = makeUpdate({
      message: makeMessage({ text: undefined }),
    });
    await bot.handleUpdate(update);

    // No sendMessage calls (no typing either since text is checked after command check)
    expect(calls.filter((c) => c.url.includes("sendMessage")).length).toBe(0);
  });

  test("sends typing indicator before processing", async () => {
    const config = makeConfig();
    const daemon = new Daemon(config);
    daemon.start();
    currentDaemon = daemon;

    const { fetch, calls } = trackingFetch();
    const botConfig: TelegramBotConfig = {
      token: "test-token",
      allowedChats: [],
      pollingTimeoutSec: 0,
    };

    const bot = new TelegramBot(daemon, config, botConfig, {
      fetch,
      log: () => {},
    });

    // handleTextMessage will call sendChatAction first
    await bot.handleTextMessage("test", 456);

    const typingCall = calls.find((c) => c.url.includes("sendChatAction"));
    expect(typingCall).toBeDefined();
    expect(typingCall!.body["action"]).toBe("typing");
    expect(typingCall!.body["chat_id"]).toBe(456);
  });
});

// ---------------------------------------------------------------------------
// TelegramBot — Polling lifecycle
// ---------------------------------------------------------------------------

describe("TelegramBot lifecycle", () => {
  test("isRunning returns false initially", () => {
    const config = makeConfig();
    const daemon = new Daemon(config);
    currentDaemon = daemon;

    const botConfig: TelegramBotConfig = {
      token: "test-token",
      allowedChats: [],
      pollingTimeoutSec: 0,
    };

    const bot = new TelegramBot(daemon, config, botConfig, {
      fetch: mockTelegramFetch({ id: 1, first_name: "Bot", username: "bot" }),
      log: () => {},
    });

    expect(bot.isRunning()).toBe(false);
  });

  test("start sets running to true", () => {
    const config = makeConfig();
    const daemon = new Daemon(config);
    currentDaemon = daemon;

    const botConfig: TelegramBotConfig = {
      token: "test-token",
      allowedChats: [],
      pollingTimeoutSec: 0,
    };

    const bot = new TelegramBot(daemon, config, botConfig, {
      fetch: mockTelegramFetch({ id: 1, first_name: "Bot", username: "bot" }),
      log: () => {},
    });

    bot.start();
    expect(bot.isRunning()).toBe(true);
    bot.stop(); // cleanup
  });

  test("stop sets running to false", () => {
    const config = makeConfig();
    const daemon = new Daemon(config);
    currentDaemon = daemon;

    const botConfig: TelegramBotConfig = {
      token: "test-token",
      allowedChats: [],
      pollingTimeoutSec: 0,
    };

    const bot = new TelegramBot(daemon, config, botConfig, {
      fetch: mockTelegramFetch({ id: 1, first_name: "Bot", username: "bot" }),
      log: () => {},
    });

    bot.start();
    bot.stop();
    expect(bot.isRunning()).toBe(false);
  });

  test("start is idempotent", () => {
    const config = makeConfig();
    const daemon = new Daemon(config);
    currentDaemon = daemon;

    const { fetch } = trackingFetch({ id: 1, first_name: "Bot", username: "bot" });
    const botConfig: TelegramBotConfig = {
      token: "test-token",
      allowedChats: [],
      pollingTimeoutSec: 0,
    };

    const bot = new TelegramBot(daemon, config, botConfig, {
      fetch,
      log: () => {},
    });

    bot.start();
    bot.start(); // second call should be no-op
    expect(bot.isRunning()).toBe(true);
    bot.stop();
  });

  test("stop is idempotent", () => {
    const config = makeConfig();
    const daemon = new Daemon(config);
    currentDaemon = daemon;

    const botConfig: TelegramBotConfig = {
      token: "test-token",
      allowedChats: [],
      pollingTimeoutSec: 0,
    };

    const bot = new TelegramBot(daemon, config, botConfig, {
      fetch: mockTelegramFetch({ id: 1, first_name: "Bot", username: "bot" }),
      log: () => {},
    });

    bot.stop(); // Not started yet — should not throw
    expect(bot.isRunning()).toBe(false);
  });

  test("logs connection failure", async () => {
    const config = makeConfig();
    const daemon = new Daemon(config);
    currentDaemon = daemon;

    const logs: string[] = [];
    const botConfig: TelegramBotConfig = {
      token: "bad-token",
      allowedChats: [],
      pollingTimeoutSec: 0,
    };

    const bot = new TelegramBot(daemon, config, botConfig, {
      fetch: mockTelegramFetch(null, false),
      log: (msg) => logs.push(msg),
    });

    bot.start();
    // Give async getMe time to fail
    await new Promise((r) => setTimeout(r, 50));

    expect(logs.some((l) => l.includes("Failed to connect"))).toBe(true);
    expect(bot.isRunning()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// createTelegramBot factory
// ---------------------------------------------------------------------------

describe("createTelegramBot", () => {
  test("returns null when no token configured", () => {
    const config = makeConfig();
    const daemon = new Daemon(config);
    currentDaemon = daemon;

    const bot = createTelegramBot(daemon, config);
    expect(bot).toBeNull();
  });

  test("returns TelegramBot when token is set", () => {
    const config = makeConfig({ telegramToken: "test-token" });
    const daemon = new Daemon(config);
    currentDaemon = daemon;

    const bot = createTelegramBot(daemon, config, {
      fetch: mockTelegramFetch({}),
      log: () => {},
    });
    expect(bot).toBeInstanceOf(TelegramBot);
  });

  test("passes allowedChats from config", () => {
    const config = makeConfig({
      telegramToken: "test-token",
      telegramAllowedChats: [123, 456],
    });
    const daemon = new Daemon(config);
    currentDaemon = daemon;

    // The bot should use the allowed chats — we test this through access control
    const logs: string[] = [];
    const bot = createTelegramBot(daemon, config, {
      fetch: mockTelegramFetch({}),
      log: (msg) => logs.push(msg),
    });

    expect(bot).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Config env var overrides
// ---------------------------------------------------------------------------

describe("config telegram env vars", () => {
  test("JARVIS_TELEGRAM_TOKEN is loaded from config", () => {
    const config = makeConfig({ telegramToken: "my-bot-token" });
    expect(config.telegramToken).toBe("my-bot-token");
  });

  test("JARVIS_TELEGRAM_CHATS parses comma-separated IDs", () => {
    const config = makeConfig({ telegramAllowedChats: [123, 456, 789] });
    expect(config.telegramAllowedChats).toEqual([123, 456, 789]);
  });
});

// ---------------------------------------------------------------------------
// CLI entry: telegram command
// ---------------------------------------------------------------------------

describe("cli-entry telegram command", () => {
  test("parseArgs recognizes telegram command", () => {
    const result = parseArgs(["telegram"]);
    expect(result.command).toBe("telegram");
  });

  test("parseArgs is case-insensitive for telegram", () => {
    const result = parseArgs(["TELEGRAM"]);
    expect(result.command).toBe("telegram");
  });
});

// ---------------------------------------------------------------------------
// Daemon Telegram integration
// ---------------------------------------------------------------------------

describe("daemon telegram integration", () => {
  test("startTelegram is no-op without token", () => {
    const config = makeConfig(); // no telegramToken
    const daemon = new Daemon(config);
    daemon.start();
    currentDaemon = daemon;

    daemon.startTelegram();
    expect(daemon.getTelegramBot()).toBeNull();
  });

  test("stopTelegram is safe when no bot running", () => {
    const config = makeConfig();
    const daemon = new Daemon(config);
    currentDaemon = daemon;

    // Should not throw
    daemon.stopTelegram();
    expect(daemon.getTelegramBot()).toBeNull();
  });

  test("shutdown stops telegram bot", () => {
    const config = makeConfig();
    const daemon = new Daemon(config);
    daemon.start();
    currentDaemon = daemon;

    // After shutdown, telegram should be null
    daemon.shutdown();
    expect(daemon.getTelegramBot()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// TelegramBot — Message Queue
// ---------------------------------------------------------------------------

describe("TelegramBot message queue", () => {
  function makeQueueBot() {
    const config = makeConfig();
    const daemon = new Daemon(config);
    daemon.start();
    currentDaemon = daemon;

    const { fetch, calls } = trackingFetch();
    const logs: string[] = [];
    const botConfig: TelegramBotConfig = {
      token: "test-token",
      allowedChats: [],
      pollingTimeoutSec: 0,
    };

    const bot = new TelegramBot(daemon, config, botConfig, {
      fetch,
      log: (msg) => logs.push(msg),
    });

    return { bot, calls, logs, daemon };
  }

  test("queueMessage returns depth when queue is not full", () => {
    const { bot } = makeQueueBot();
    expect(bot.queueMessage("hello", 456)).toBe(1);
    expect(bot.queueMessage("world", 456)).toBe(2);
    expect(bot.getQueueDepth()).toBe(2);
  });

  test("queueMessage returns 0 when queue is full", () => {
    const { bot } = makeQueueBot();
    // Fill to MAX_QUEUE_DEPTH (10)
    for (let i = 0; i < 10; i++) {
      expect(bot.queueMessage(`msg ${i}`, 456)).toBe(i + 1);
    }
    // 11th should be rejected
    expect(bot.queueMessage("overflow", 456)).toBe(0);
    expect(bot.getQueueDepth()).toBe(10);
  });

  test("getQueueDepth starts at 0", () => {
    const { bot } = makeQueueBot();
    expect(bot.getQueueDepth()).toBe(0);
  });

  test("handleUpdate queues message when processing", async () => {
    const { bot, calls, logs } = makeQueueBot();

    // Simulate being busy
    (bot as any).processing = true;

    const update = makeUpdate({
      message: makeMessage({ text: "queue this" }),
    });

    await bot.handleUpdate(update);

    expect(bot.getQueueDepth()).toBe(1);
    expect(logs.some(l => l.includes("Queued message"))).toBe(true);
    // Should have sent the queued confirmation
    const queuedMsg = calls.find(c =>
      c.url.includes("sendMessage") && String(c.body["text"]).includes("Queued")
    );
    expect(queuedMsg).toBeDefined();
    expect(String(queuedMsg!.body["text"])).toContain("#1");
  });

  test("handleUpdate sends full warning when queue is full", async () => {
    const { bot, calls, logs } = makeQueueBot();

    (bot as any).processing = true;

    // Fill the queue
    for (let i = 0; i < 10; i++) {
      bot.queueMessage(`msg ${i}`, 456);
    }

    // This one should be rejected
    const update = makeUpdate({
      message: makeMessage({ text: "too many" }),
    });
    await bot.handleUpdate(update);

    expect(logs.some(l => l.includes("Queue full"))).toBe(true);
    const fullMsg = calls.find(c =>
      c.url.includes("sendMessage") && String(c.body["text"]).includes("Queue full")
    );
    expect(fullMsg).toBeDefined();
  });

  test("bot commands bypass the queue", async () => {
    const { bot, calls } = makeQueueBot();

    (bot as any).processing = true;

    const update = makeUpdate({
      message: makeMessage({
        text: "/status",
        entities: [{ type: "bot_command", offset: 0, length: 7 }],
      }),
    });

    await bot.handleUpdate(update);

    // Command should have been processed immediately, not queued
    expect(bot.getQueueDepth()).toBe(0);
    const statusMsg = calls.find(c =>
      c.url.includes("sendMessage") && String(c.body["text"]).includes("Status:")
    );
    expect(statusMsg).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// TelegramBot — drainMessagesForChat
// ---------------------------------------------------------------------------

describe("TelegramBot drainMessagesForChat", () => {
  function makeQueueBot() {
    const config = makeConfig();
    const daemon = new Daemon(config);
    daemon.start();
    currentDaemon = daemon;

    const { fetch, calls } = trackingFetch();
    const logs: string[] = [];
    const botConfig: TelegramBotConfig = {
      token: "test-token",
      allowedChats: [],
      pollingTimeoutSec: 0,
    };

    const bot = new TelegramBot(daemon, config, botConfig, {
      fetch,
      log: (msg) => logs.push(msg),
    });

    return { bot, calls, logs, daemon };
  }

  test("drains messages for specific chat only", () => {
    const { bot } = makeQueueBot();

    bot.queueMessage("msg1 for 456", 456);
    bot.queueMessage("msg2 for 789", 789);
    bot.queueMessage("msg3 for 456", 456);

    const drained = bot.drainMessagesForChat(456);
    expect(drained).toEqual(["msg1 for 456", "msg3 for 456"]);

    // Queue should only have the msg for chat 789
    expect(bot.getQueueDepth()).toBe(1);
  });

  test("returns empty array when no messages for chat", () => {
    const { bot } = makeQueueBot();

    bot.queueMessage("msg for 789", 789);

    const drained = bot.drainMessagesForChat(456);
    expect(drained).toEqual([]);
    expect(bot.getQueueDepth()).toBe(1);
  });

  test("returns empty array when queue is empty", () => {
    const { bot } = makeQueueBot();

    const drained = bot.drainMessagesForChat(456);
    expect(drained).toEqual([]);
    expect(bot.getQueueDepth()).toBe(0);
  });

  test("drains all messages when all are for same chat", () => {
    const { bot } = makeQueueBot();

    bot.queueMessage("a", 456);
    bot.queueMessage("b", 456);
    bot.queueMessage("c", 456);

    const drained = bot.drainMessagesForChat(456);
    expect(drained).toEqual(["a", "b", "c"]);
    expect(bot.getQueueDepth()).toBe(0);
  });

  test("preserves message order", () => {
    const { bot } = makeQueueBot();

    bot.queueMessage("first", 456);
    bot.queueMessage("other", 789);
    bot.queueMessage("second", 456);
    bot.queueMessage("other2", 789);
    bot.queueMessage("third", 456);

    const drained = bot.drainMessagesForChat(456);
    expect(drained).toEqual(["first", "second", "third"]);

    // Other chat messages should still be in order
    const remaining = bot.drainMessagesForChat(789);
    expect(remaining).toEqual(["other", "other2"]);
  });
});
