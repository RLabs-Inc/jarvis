// ---------------------------------------------------------------------------
// Telegram Notification — Send messages from autonomous tasks
// ---------------------------------------------------------------------------
//
// When an autonomous task completes, Jarvis should let Sherlock know
// what happened. This module sends a Telegram message directly via the
// Bot API — independent of the long-polling Telegram bot process.
//
// Used by the wake handler after task execution.
// ---------------------------------------------------------------------------

import type { JarvisConfig } from "../config.ts";

const TELEGRAM_API_BASE = "https://api.telegram.org/bot";

/** Maximum Telegram message length */
const MAX_MESSAGE_LENGTH = 4096;

/** Options for notification */
export interface NotifyOptions {
  /** Override fetch for testing */
  fetchFn?: typeof globalThis.fetch;
}

/**
 * Send a Telegram notification to all configured allowed chats.
 * Returns true if at least one message was sent successfully.
 * Silently fails if Telegram is not configured — notifications
 * are best-effort, never blocking.
 */
export async function notifyTelegram(
  config: JarvisConfig,
  message: string,
  options: NotifyOptions = {},
): Promise<boolean> {
  const token = config.telegramToken;
  const chats = config.telegramAllowedChats;

  if (!token || !chats || chats.length === 0) {
    return false;
  }

  const fetchFn = options.fetchFn ?? globalThis.fetch;
  const text = message.slice(0, MAX_MESSAGE_LENGTH);
  let anySent = false;

  for (const chatId of chats) {
    try {
      const url = `${TELEGRAM_API_BASE}${token}/sendMessage`;
      const response = await fetchFn(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text,
        }),
      });

      const data = (await response.json()) as { ok: boolean };
      if (data.ok) {
        anySent = true;
      }
    } catch {
      // Best-effort — don't let notification failures affect the task
    }
  }

  return anySent;
}

/**
 * Format a wake task result into a human-readable notification message.
 * Keeps it concise — this is a brief check-in, not a full report.
 */
export function formatWakeNotification(
  taskName: string,
  success: boolean,
  throttled: boolean,
  response: string,
  durationMs: number,
  error?: string,
): string {
  const duration = formatDuration(durationMs);

  if (throttled) {
    return `⏸️ ${taskName} deferred (rate limits) — ${duration}`;
  }

  if (!success) {
    const errMsg = error ? `: ${error.slice(0, 200)}` : "";
    return `❌ ${taskName} failed${errMsg} — ${duration}`;
  }

  // For successful tasks, include a summary of what happened.
  // The response can be very long (especially daily_reflection),
  // so we extract a meaningful excerpt.
  const summary = extractSummary(response, 3500);
  return `✅ ${taskName} (${duration})\n\n${summary}`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

/**
 * Extract a meaningful summary from a task response.
 * Tries to find the most informative portion within the character budget.
 */
function extractSummary(response: string, maxLen: number): string {
  if (!response.trim()) return "(no output)";
  if (response.length <= maxLen) return response;

  // Try to cut at a paragraph boundary
  const truncated = response.slice(0, maxLen);
  const lastParagraph = truncated.lastIndexOf("\n\n");
  if (lastParagraph > maxLen * 0.5) {
    return truncated.slice(0, lastParagraph) + "\n\n…";
  }

  // Try to cut at a newline
  const lastNewline = truncated.lastIndexOf("\n");
  if (lastNewline > maxLen * 0.5) {
    return truncated.slice(0, lastNewline) + "\n…";
  }

  // Hard cut
  return truncated.slice(0, maxLen - 1) + "…";
}
