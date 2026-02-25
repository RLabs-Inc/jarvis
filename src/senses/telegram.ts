// ---------------------------------------------------------------------------
// Telegram Sense — Remote Messaging Interface
// ---------------------------------------------------------------------------
//
// The second sense: Sherlock talks to Jarvis from anywhere via Telegram.
//
// Features:
//   - Long polling via getUpdates (no webhooks, no public URL needed)
//   - Access control via allowed chat IDs (only Sherlock gets through)
//   - Message queuing: send messages while Jarvis is working
//   - Inline queue injection: queued messages are sent to Claude alongside
//     tool results or after turn completion, so Claude sees them in context
//   - Message splitting for responses > 4096 chars (Telegram limit)
//   - Bot commands: /status, /session, /tiers
//   - "typing" indicator while processing
//   - Streaming responses with progressive message editing
//   - HTML formatting with Markdown conversion
//   - Automatic reconnection on polling errors
//
// Like the CLI, Telegram is thin — it receives messages, feeds them to the
// Daemon, accumulates the response, and sends it back. The Daemon does the
// real work.
// ---------------------------------------------------------------------------

import { Daemon } from "../daemon.ts";
import { StreamingMessage } from "./telegram-stream.ts";
import type { DaemonStats } from "../daemon.ts";
import { validateTierBudgets } from "../context/tiers.ts";
import type { JarvisConfig } from "../config.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Telegram Update object (only fields we use) */
export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

/** Telegram Message object (only fields we use) */
export interface TelegramMessage {
  message_id: number;
  from?: { id: number; first_name: string; username?: string };
  chat: { id: number; type: string };
  date: number;
  text?: string;
  entities?: TelegramEntity[];
}

/** Telegram MessageEntity */
export interface TelegramEntity {
  type: string;
  offset: number;
  length: number;
}

/** Telegram API response envelope */
export interface TelegramApiResponse<T = unknown> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

/** Configuration for the Telegram bot */
export interface TelegramBotConfig {
  token: string;
  allowedChats: number[];
  pollingTimeoutSec: number;
}

/** Dependencies injected for testing */
export interface TelegramDeps {
  /** Override fetch for testing */
  fetch?: typeof globalThis.fetch;
  /** Override for logging */
  log?: (msg: string) => void;
}

/** A queued message waiting to be processed */
interface QueuedMessage {
  text: string;
  chatId: number;
}

/** Maximum number of messages that can be queued */
const MAX_QUEUE_DEPTH = 10;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TELEGRAM_API_BASE = "https://api.telegram.org/bot";

/** Telegram message character limit */
export const MAX_MESSAGE_LENGTH = 4096;

/** Bot commands we handle */
export const BOT_COMMANDS = ["/status", "/session", "/tiers", "/start", "/help"] as const;
export type BotCommand = (typeof BOT_COMMANDS)[number];

/** Delay before retrying after a polling error (ms) */
const POLL_RETRY_DELAY_MS = 5_000;

/** Maximum retry delay after consecutive failures (ms) */
const MAX_RETRY_DELAY_MS = 60_000;

// ---------------------------------------------------------------------------
// Telegram API Helpers (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Call a Telegram Bot API method.
 * Returns the parsed response or throws on network/API error.
 */
export async function callTelegramApi<T>(
  token: string,
  method: string,
  params: Record<string, unknown> = {},
  fetchFn: typeof globalThis.fetch = globalThis.fetch,
): Promise<T> {
  const url = `${TELEGRAM_API_BASE}${token}/${method}`;

  const response = await fetchFn(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });

  const data = (await response.json()) as TelegramApiResponse<T>;

  if (!data.ok) {
    throw new Error(
      `Telegram API error: ${data.description ?? "unknown"} (${data.error_code ?? response.status})`,
    );
  }

  return data.result as T;
}

/**
 * Split a long message into chunks that fit within Telegram's limit.
 * Tries to split at newline boundaries when possible.
 */
export function splitMessage(text: string, maxLen: number = MAX_MESSAGE_LENGTH): string[] {
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }

    // Try to split at a newline near the limit
    let splitAt = remaining.lastIndexOf("\n", maxLen);
    if (splitAt <= 0 || splitAt < maxLen * 0.5) {
      // No good newline — try space
      splitAt = remaining.lastIndexOf(" ", maxLen);
    }
    if (splitAt <= 0 || splitAt < maxLen * 0.5) {
      // No good boundary — hard split
      splitAt = maxLen;
    }

    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).replace(/^\n/, ""); // strip leading newline from next chunk
  }

  return chunks;
}

/**
 * Escape text for Telegram MarkdownV2 format.
 * Per API docs: characters _*[]()~`>#+-=|{}.! must be escaped with \.
 */
export function escapeMarkdownV2(text: string): string {
  return text.replace(/([_*\[\]()~`>#\+\-=|{}.!\\])/g, "\\$1");
}

/**
 * Format a response for Telegram. Wraps code blocks in backticks
 * and escapes the rest for MarkdownV2.
 *
 * Falls back to plain text if formatting produces errors.
 */
export function formatForTelegram(text: string): { text: string; parseMode?: string } {
  // If the text contains code blocks (```), try MarkdownV2 formatting
  if (text.includes("```")) {
    try {
      const formatted = formatCodeBlocks(text);
      return { text: formatted, parseMode: "MarkdownV2" };
    } catch {
      // Fall back to plain text
    }
  }

  // Plain text — no formatting needed
  return { text };
}

/**
 * Format text with code blocks for MarkdownV2.
 * Code blocks are preserved as-is (backtick-delimited), rest is escaped.
 */
function formatCodeBlocks(text: string): string {
  const parts: string[] = [];
  const codeBlockRegex = /```(\w*)\n?([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = codeBlockRegex.exec(text)) !== null) {
    // Escape the text before this code block
    if (match.index > lastIndex) {
      parts.push(escapeMarkdownV2(text.slice(lastIndex, match.index)));
    }

    // Preserve the code block (only escape backticks and backslashes inside)
    const lang = match[1] ?? "";
    const code = match[2] ?? "";
    parts.push("```" + lang + "\n" + code.replace(/\\/g, "\\\\").replace(/`/g, "\\`") + "```");

    lastIndex = match.index + match[0].length;
  }

  // Escape remaining text after last code block
  if (lastIndex < text.length) {
    parts.push(escapeMarkdownV2(text.slice(lastIndex)));
  }

  return parts.join("");
}

/**
 * Extract bot command from a message (e.g., "/status" from "/status@jarvis_bot").
 * Returns the command if recognized, null otherwise.
 */
export function extractBotCommand(message: TelegramMessage): BotCommand | null {
  if (!message.text || !message.entities) return null;

  // Find bot_command entity at position 0
  const commandEntity = message.entities.find(
    (e) => e.type === "bot_command" && e.offset === 0,
  );
  if (!commandEntity) return null;

  // Extract the command text, strip bot username suffix (@jarvis_bot)
  const raw = message.text.slice(0, commandEntity.length);
  const command = raw.split("@")[0]!.toLowerCase();

  if (BOT_COMMANDS.includes(command as BotCommand)) {
    return command as BotCommand;
  }

  return null;
}

/**
 * Check if a chat ID is in the allowed list.
 * If allowedChats is empty, all chats are allowed (open mode).
 */
export function isChatAllowed(chatId: number, allowedChats: number[]): boolean {
  if (allowedChats.length === 0) return true;
  return allowedChats.includes(chatId);
}

// ---------------------------------------------------------------------------
// Telegram Bot
// ---------------------------------------------------------------------------

export class TelegramBot {
  private running = false;
  private pollAbort: AbortController | null = null;
  private offset = 0;
  private consecutiveErrors = 0;
  private processing = false;
  private readonly messageQueue: QueuedMessage[] = [];
  private readonly fetchFn: typeof globalThis.fetch;
  private readonly log: (msg: string) => void;

  constructor(
    private readonly daemon: Daemon,
    private readonly config: JarvisConfig,
    private readonly botConfig: TelegramBotConfig,
    deps: TelegramDeps = {},
  ) {
    this.fetchFn = deps.fetch ?? globalThis.fetch;
    this.log = deps.log ?? ((msg: string) => console.log(`[telegram] ${msg}`));
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  /**
   * Start the long-polling loop. Returns immediately.
   * The polling runs in the background as a fire-and-forget loop.
   */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.log("Bot starting...");

    // Validate token by calling getMe
    this.callApi<{ id: number; first_name: string; username: string }>("getMe")
      .then((me) => {
        this.log(`Connected as @${me.username} (${me.first_name})`);
        this.pollLoop();
      })
      .catch((err) => {
        this.log(`Failed to connect: ${err instanceof Error ? err.message : String(err)}`);
        this.running = false;
      });
  }

  /**
   * Stop the polling loop gracefully.
   */
  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.pollAbort?.abort();
    this.pollAbort = null;
    this.log("Bot stopped.");
  }

  /**
   * Whether the bot is currently running.
   */
  isRunning(): boolean {
    return this.running;
  }

  // -----------------------------------------------------------------------
  // Message Queue
  // -----------------------------------------------------------------------

  /**
   * Queue a message for processing after the current one finishes.
   * Returns the queue depth (1-based position).
   * Returns 0 if the queue is full (message rejected).
   */
  queueMessage(text: string, chatId: number): number {
    if (this.messageQueue.length >= MAX_QUEUE_DEPTH) {
      return 0;
    }
    this.messageQueue.push({ text, chatId });
    return this.messageQueue.length;
  }

  /**
   * Get current queue depth (for testing/status).
   */
  getQueueDepth(): number {
    return this.messageQueue.length;
  }

  /**
   * Drain all pending messages from the queue for a specific chat.
   * Returns the message texts and removes them from the queue.
   * Messages from other chats remain in the queue.
   */
  drainMessagesForChat(chatId: number): string[] {
    const drained: string[] = [];
    const remaining: QueuedMessage[] = [];

    for (const msg of this.messageQueue) {
      if (msg.chatId === chatId) {
        drained.push(msg.text);
      } else {
        remaining.push(msg);
      }
    }

    // Replace the queue with remaining messages
    this.messageQueue.length = 0;
    for (const msg of remaining) {
      this.messageQueue.push(msg);
    }

    return drained;
  }

  // -----------------------------------------------------------------------
  // Polling Loop
  // -----------------------------------------------------------------------

  private async pollLoop(): Promise<void> {
    while (this.running) {
      try {
        this.pollAbort = new AbortController();

        const updates = await this.getUpdates();
        this.consecutiveErrors = 0;

        for (const update of updates) {
          this.offset = update.update_id + 1;

          if (update.message) {
            // Fire-and-forget so polling continues while processing
            this.handleUpdate(update).catch((err) => {
              this.log(`Update error: ${err instanceof Error ? err.message : String(err)}`);
            });
          }
        }
      } catch (err) {
        if (!this.running) break; // Intentional shutdown

        this.consecutiveErrors++;
        const delay = Math.min(
          POLL_RETRY_DELAY_MS * Math.pow(2, this.consecutiveErrors - 1),
          MAX_RETRY_DELAY_MS,
        );
        this.log(
          `Polling error (attempt ${this.consecutiveErrors}): ${err instanceof Error ? err.message : String(err)}. Retrying in ${delay}ms...`,
        );

        await sleep(delay);
      }
    }
  }

  private async getUpdates(): Promise<TelegramUpdate[]> {
    return this.callApi<TelegramUpdate[]>("getUpdates", {
      offset: this.offset,
      timeout: this.botConfig.pollingTimeoutSec,
      allowed_updates: ["message"],
    });
  }

  // -----------------------------------------------------------------------
  // Message Handling
  // -----------------------------------------------------------------------

  /** Exposed for testing — processes a single update */
  async handleUpdate(update: TelegramUpdate): Promise<void> {
    const message = update.message;
    if (!message) return;

    const chatId = message.chat.id;

    // Access control
    if (!isChatAllowed(chatId, this.botConfig.allowedChats)) {
      this.log(`Rejected message from chat ${chatId} (not in allowed list)`);
      return;
    }

    // Bot commands always go through immediately
    const command = extractBotCommand(message);
    if (command) {
      await this.handleCommand(command, chatId);
      return;
    }

    if (!message.text) return;

    // Queue if already processing another message
    if (this.processing) {
      const depth = this.queueMessage(message.text, chatId);
      if (depth > 0) {
        this.log(`Queued message (depth: ${depth})`);
        await this.sendMessage(chatId, `📋 Queued (#${depth}) — I'll see it with my next tool result or when I finish.`).catch(() => {});
      } else {
        this.log("Queue full — rejected message");
        await this.sendMessage(chatId, "⚠️ Queue full — please wait for me to finish.").catch(() => {});
      }
      return;
    }

    await this.handleTextMessage(message.text, chatId);
  }

  /** Exposed for testing — handles a bot command */
  async handleCommand(command: BotCommand, chatId: number): Promise<void> {
    let response: string;

    switch (command) {
      case "/start":
      case "/help":
        response = formatHelpMessage();
        break;

      case "/status":
        response = formatStatusMessage(this.daemon.getStats());
        break;

      case "/session": {
        const session = this.daemon.getSessionManager().getActiveSession();
        if (session) {
          const durationMs = this.daemon.getSessionManager().getSessionDurationMs();
          response = `Session: ${session.id}\nMessages: ${session.messageCount}\nDuration: ${formatDurationShort(durationMs)}`;
        } else {
          response = "No active session.";
        }
        break;
      }

      case "/tiers":
        try {
          const report = await validateTierBudgets(this.config);
          const lines: string[] = ["Tier Status:"];
          for (const tier of report.tiers) {
            const pct = tier.budget > 0 ? ((tier.tokens / tier.budget) * 100).toFixed(1) : "0.0";
            lines.push(`  T${tier.tier}: ${tier.tokens.toLocaleString()}/${tier.budget.toLocaleString()} (${pct}%)`);
          }
          response = lines.join("\n");
        } catch (err) {
          response = `Error reading tier stats: ${err instanceof Error ? err.message : String(err)}`;
        }
        break;

      default:
        response = `Unknown command: ${command}`;
    }

    await this.sendMessage(chatId, response);
  }

  /** Exposed for testing — handles a regular text message */
  async handleTextMessage(text: string, chatId: number): Promise<void> {
    this.processing = true;
    try {
      await this.sendChatAction(chatId, "typing").catch(() => {});

      // Create the pending messages drain callback for this chat.
      // The conversation loop will call this to check for queued messages.
      const pendingMessages = () => this.drainMessagesForChat(chatId);

      const stream = new StreamingMessage({
        chatId,
        editIntervalMs: 1500,
        callApi: (method, params) => this.callApi(method, params),
      });

      let hadError = false;

      for await (const event of this.daemon.handleMessage(text, pendingMessages)) {
        switch (event.type) {
          case "text_delta":
            stream.appendText(event.text);
            break;

          case "tool_call":
            await stream.showToolCall(event.toolName, event.toolId, event.input);
            await this.sendChatAction(chatId, "typing").catch(() => {});
            break;

          case "tool_result":
            stream.showToolResult(event.toolId, event.isError, event.content);
            break;

          case "queued_messages":
            // Notify the user that their queued messages were delivered
            for (const msg of event.messages) {
              this.log(`Injected queued message into conversation: "${msg.slice(0, 50)}..."`);
            }
            stream.appendText(`\n\n📨 [${event.messages.length} queued message${event.messages.length > 1 ? "s" : ""} received]`);
            break;

          case "error":
            if (!event.recoverable) {
              hadError = true;
              stream.appendText(`\n\nError: ${event.error.message}`);
            }
            break;

          case "turn_complete":
            await stream.flush();
            break;
        }
      }

      await stream.flush();

      if (!stream.getFullText().trim()) {
        const fallback = hadError
          ? "Something went wrong processing your message."
          : "(No response generated)";
        await this.sendMessage(chatId, fallback);
      }
    } finally {
      this.processing = false;
    }

    // Drain any remaining messages from OTHER chats that might be queued.
    // (Messages for this chat should have already been injected by the
    // conversation loop via pendingMessages callback.)
    await this.drainRemainingQueue();
  }

  // -----------------------------------------------------------------------
  // Queue Draining
  // -----------------------------------------------------------------------

  /**
   * Process remaining queued messages from other chats.
   * Messages from the active chat should have already been injected
   * inline via the pendingMessages callback during conversation.
   */
  private async drainRemainingQueue(): Promise<void> {
    while (this.messageQueue.length > 0) {
      const next = this.messageQueue.shift()!;
      this.log(`Processing queued message from chat ${next.chatId} (${this.messageQueue.length} remaining)`);
      await this.handleTextMessage(next.text, next.chatId);
    }
  }

  // -----------------------------------------------------------------------
  // Sending Messages
  // -----------------------------------------------------------------------

  async sendMessage(
    chatId: number,
    text: string,
    parseMode?: string,
  ): Promise<void> {
    await this.callApi("sendMessage", {
      chat_id: chatId,
      text,
      ...(parseMode ? { parse_mode: parseMode } : {}),
    });
  }

  private async sendChatAction(chatId: number, action: string): Promise<void> {
    await this.callApi("sendChatAction", {
      chat_id: chatId,
      action,
    });
  }

  // -----------------------------------------------------------------------
  // API Helper
  // -----------------------------------------------------------------------

  private async callApi<T>(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<T> {
    return callTelegramApi<T>(this.botConfig.token, method, params, this.fetchFn);
  }
}

// ---------------------------------------------------------------------------
// Formatting Helpers
// ---------------------------------------------------------------------------

function formatHelpMessage(): string {
  return [
    "Jarvis - Your personal AI vessel",
    "",
    "Commands:",
    "  /status  - Show daemon status",
    "  /session - Show current session info",
    "  /tiers   - Show tier token usage",
    "  /help    - Show this help",
    "",
    "Or just send a message to start talking.",
  ].join("\n");
}

function formatStatusMessage(stats: DaemonStats): string {
  return [
    `Status: ${stats.status}`,
    `Session: ${stats.sessionId ?? "none"}`,
    `Messages: ${stats.messageCount}`,
    `Uptime: ${formatDurationShort(stats.uptime)}`,
  ].join("\n");
}

function formatDurationShort(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a TelegramBot from JarvisConfig.
 * Returns null if telegram is not configured.
 */
export function createTelegramBot(
  daemon: Daemon,
  config: JarvisConfig,
  deps: TelegramDeps = {},
): TelegramBot | null {
  if (!config.telegramToken) return null;

  const botConfig: TelegramBotConfig = {
    token: config.telegramToken,
    allowedChats: config.telegramAllowedChats ?? [],
    pollingTimeoutSec: 30,
  };

  return new TelegramBot(daemon, config, botConfig, deps);
}
