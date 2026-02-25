// ---------------------------------------------------------------------------
// Telegram Streaming Message — One Message Per Content Unit
// ---------------------------------------------------------------------------
//
// Redesigned strategy: instead of accumulating everything into one giant
// message that gets edited repeatedly (causing sync/corruption issues),
// each content unit gets its own Telegram message:
//
//   💭 Thinking message (collapsible, sent as a complete block)
//   📝 Text message (stream-edited within this one message only)
//   🔧 Tool call message (one per tool, edited when result arrives)
//   📝 Next text message (new message for the next text block)
//
// This eliminates the "mid-word corruption" issue caused by rapid edits
// to a single growing message containing mixed content types.
//
// Messages use HTML parse mode for reliable Markdown-like formatting.
//
// Telegram rate limits: ~30 messages/sec in chats, ~20 edits/min in groups.
// We use 1500ms throttle for edits, which is comfortable for DMs.
// ---------------------------------------------------------------------------

/** Telegram API call function signature */
export type TelegramApiCall = <T>(method: string, params: Record<string, unknown>) => Promise<T>;

/** Telegram sendMessage result */
interface SentMessage {
  message_id: number;
  chat: { id: number };
}

/** Configuration for StreamingMessage */
export interface StreamingMessageOptions {
  chatId: number;
  editIntervalMs?: number;
  callApi: TelegramApiCall;
}

/** Max message length for Telegram */
const MAX_MESSAGE_LENGTH = 4096;

/** Max length for the detail portion of a tool indicator */
const MAX_INDICATOR_DETAIL = 60;

// ---------------------------------------------------------------------------
// HTML Formatting for Telegram
// ---------------------------------------------------------------------------

/**
 * Escape text for Telegram HTML format.
 * Only <, >, & and " need escaping in HTML mode.
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Convert a subset of Markdown to Telegram HTML.
 *
 * Supported conversions:
 *   - **bold** → <b>bold</b>
 *   - *italic* → <i>italic</i>
 *   - ~~strikethrough~~ → <s>strikethrough</s>
 *   - `inline code` → <code>inline code</code>
 *   - ```lang\ncode``` → <pre><code class="language-lang">code</code></pre>
 *   - [text](url) → <a href="url">text</a>
 *   - # Headings → <b>Headings</b>
 *   - > blockquote → <blockquote>blockquote</blockquote>
 *   - - bullet list → • bullet list
 *   - --- → ———
 *
 * Everything else is HTML-escaped for safety.
 *
 * Falls back to plain text (no parse_mode) if conversion produces errors.
 */
export function markdownToHtml(text: string): { text: string; parseMode?: string } {
  try {
    const html = convertMarkdown(text);
    return { text: html, parseMode: "HTML" };
  } catch {
    // Fall back to plain text — better to show raw markdown than crash
    return { text };
  }
}

/**
 * Internal Markdown→HTML conversion.
 * Processes code blocks first (protected from other transformations),
 * then applies inline formatting to the rest.
 */
function convertMarkdown(text: string): string {
  const parts: string[] = [];
  const codeBlockRegex = /```(\w*)\n?([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = codeBlockRegex.exec(text)) !== null) {
    // Convert the text before this code block
    if (match.index > lastIndex) {
      parts.push(convertBlockMarkdown(text.slice(lastIndex, match.index)));
    }

    // Code block → <pre><code> with optional language for syntax highlighting
    const lang = match[1] ?? "";
    const code = match[2] ?? "";
    if (lang) {
      parts.push(`<pre><code class="language-${escapeHtml(lang)}">${escapeHtml(code)}</code></pre>`);
    } else {
      parts.push(`<pre>${escapeHtml(code)}</pre>`);
    }

    lastIndex = match.index + match[0].length;
  }

  // Convert remaining text after last code block
  if (lastIndex < text.length) {
    parts.push(convertBlockMarkdown(text.slice(lastIndex)));
  }

  return parts.join("");
}

/**
 * Convert block-level Markdown elements (blockquotes, lists, rules),
 * then delegate to inline conversion for the rest.
 */
function convertBlockMarkdown(text: string): string {
  const lines = text.split("\n");
  const result: string[] = [];
  let inBlockquote = false;
  const blockquoteLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    // Blockquote: lines starting with >
    if (/^>\s?/.test(line)) {
      const content = line.replace(/^>\s?/, "");
      blockquoteLines.push(content);
      inBlockquote = true;
      continue;
    }

    // End of blockquote — flush accumulated lines
    if (inBlockquote) {
      const bqContent = blockquoteLines.map(l => convertInlineMarkdown(l)).join("\n");
      result.push(`<blockquote>${bqContent}</blockquote>`);
      blockquoteLines.length = 0;
      inBlockquote = false;
    }

    // Horizontal rule: --- or *** or ___ (3+ chars, alone on a line)
    if (/^[\-\*_]{3,}\s*$/.test(line)) {
      result.push("———");
      continue;
    }

    // Unordered list: - item or * item (at start of line)
    if (/^[\-\*]\s+/.test(line)) {
      const content = line.replace(/^[\-\*]\s+/, "");
      result.push(`• ${convertInlineMarkdown(content)}`);
      continue;
    }

    // Everything else — inline conversion
    result.push(convertInlineMarkdown(line));
  }

  // Flush any remaining blockquote
  if (inBlockquote && blockquoteLines.length > 0) {
    const bqContent = blockquoteLines.map(l => convertInlineMarkdown(l)).join("\n");
    result.push(`<blockquote>${bqContent}</blockquote>`);
  }

  return result.join("\n");
}

/**
 * Convert inline Markdown elements to HTML.
 * Handles: bold, italic, strikethrough, inline code, links, headings.
 * Protects inline code spans from other transformations.
 */
function convertInlineMarkdown(text: string): string {
  // First, extract inline code spans to protect them
  const codeSpans: string[] = [];
  let processed = text.replace(/`([^`\n]+)`/g, (_match, code: string) => {
    const idx = codeSpans.length;
    codeSpans.push(`<code>${escapeHtml(code)}</code>`);
    return `\x00CODE${idx}\x00`;
  });

  // Escape HTML in the non-code text
  processed = escapeHtml(processed);

  // Headings: lines starting with # → bold
  processed = processed.replace(/^(#{1,6})\s+(.+)$/gm, (_match, _hashes: string, content: string) => {
    return `<b>${content}</b>`;
  });

  // Bold: **text** or __text__
  processed = processed.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  processed = processed.replace(/__(.+?)__/g, "<b>$1</b>");

  // Italic: *text* (but not **bold** which was already converted)
  // Only match * for italic to avoid conflicts with underscores in identifiers
  processed = processed.replace(/(?<!\w)\*(?!\*)(.+?)(?<!\*)\*(?!\w)/g, "<i>$1</i>");

  // Strikethrough: ~~text~~
  processed = processed.replace(/~~(.+?)~~/g, "<s>$1</s>");

  // Links: [text](url) — the [] and () were HTML-escaped, so match escaped versions
  processed = processed.replace(
    /\[([^\]]*)\]\(([^)]*)\)/g,
    '<a href="$2">$1</a>'
  );

  // Restore inline code spans
  processed = processed.replace(/\x00CODE(\d+)\x00/g, (_match, idx: string) => {
    return codeSpans[parseInt(idx, 10)] ?? "";
  });

  return processed;
}

/**
 * Format a rich tool call indicator based on tool name and input.
 * Returns a human-readable one-liner like:
 *   🔧 ls -la ⏳
 *   📄 /opt/jarvis/src/daemon.ts ⏳
 *   ✏️ /opt/jarvis/src/config.ts (1,240 chars) ⏳
 *   🖥️ mac-mini → ls -la ⏳
 *   🌐 GET https://api.example.com/status ⏳
 *   ⏰ cron add: daily-check ⏳
 */
export function formatToolIndicator(toolName: string, input: Record<string, unknown>): string {
  let detail: string;

  switch (toolName) {
    case "bash": {
      const cmd = truncate(String(input["command"] ?? ""), MAX_INDICATOR_DETAIL);
      const interactive = input["interactive"] ? " (pty)" : "";
      detail = `${cmd}${interactive}`;
      break;
    }

    case "read_file": {
      const path = shortPath(String(input["path"] ?? ""));
      const range = formatRange(input["offset"] as number | undefined, input["limit"] as number | undefined);
      detail = `${path}${range}`;
      break;
    }

    case "write_file": {
      const path = shortPath(String(input["path"] ?? ""));
      const content = String(input["content"] ?? "");
      const size = content.length >= 1000
        ? `${(content.length / 1000).toFixed(1)}k chars`
        : `${content.length} chars`;
      detail = `${path} (${size})`;
      break;
    }

    case "ssh_exec": {
      const host = String(input["host"] ?? "");
      const cmd = truncate(String(input["command"] ?? ""), MAX_INDICATOR_DETAIL - host.length - 4);
      detail = `${host} → ${cmd}`;
      break;
    }

    case "web_fetch": {
      const method = String(input["method"] ?? "GET").toUpperCase();
      const url = truncate(String(input["url"] ?? ""), MAX_INDICATOR_DETAIL);
      detail = `${method} ${url}`;
      break;
    }

    case "cron_manage": {
      const action = String(input["action"] ?? "list");
      const id = input["id"] ? `: ${input["id"]}` : "";
      detail = `cron ${action}${id}`;
      break;
    }

    default:
      detail = toolName;
      break;
  }

  const icon = toolIcon(toolName);
  return `${icon} ${detail}`;
}

/**
 * Format the outcome portion of a tool result.
 * Returns just the outcome like:
 *   ✓ (exit 0, 15 lines)
 *   ✗ exit 1: "command not found"
 *   ✓ 248 lines
 *   ✓ saved
 */
export function formatToolResultOutcome(
  toolName: string,
  content: string,
  isError: boolean,
): string {
  if (isError) {
    const snippet = extractErrorSnippet(content);
    return `✗ ${snippet}`;
  }

  switch (toolName) {
    case "bash": {
      const info = parseBashResult(content);
      return `✓${info}`;
    }

    case "read_file": {
      const lines = content.split("\n").length;
      return `✓ ${lines} line${lines !== 1 ? "s" : ""}`;
    }

    case "write_file":
      return "✓ saved";

    case "ssh_exec": {
      const lines = content.split("\n").filter(l => l.trim()).length;
      return lines > 0
        ? `✓ ${lines} line${lines !== 1 ? "s" : ""}`
        : "✓";
    }

    case "web_fetch": {
      const info = parseWebResult(content);
      return `✓${info}`;
    }

    case "cron_manage":
      return "✓";

    default:
      return "✓";
  }
}

/**
 * Format a complete tool outcome line (icon + detail + arrow + result).
 * Used when composing the final display:
 *   🔧 ls -la → ✓ (3 lines)
 *   📄 /opt/jarvis/src/daemon.ts → ✓ 248 lines
 *   ✏️ /opt/jarvis/config.ts (500 chars) → ✓ saved
 */
export function formatToolOutcome(
  toolName: string,
  content: string,
  isError: boolean,
): string {
  const icon = toolIcon(toolName);
  const outcome = formatToolResultOutcome(toolName, content, isError);
  return `${icon} ${outcome}`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toolIcon(toolName: string): string {
  switch (toolName) {
    case "bash": return "🔧";
    case "read_file": return "📄";
    case "write_file": return "✏️";
    case "ssh_exec": return "🖥️";
    case "web_fetch": return "🌐";
    case "cron_manage": return "⏰";
    default: return "⚙️";
  }
}

function truncate(text: string, maxLen: number): string {
  // Take only the first line to keep indicators compact
  const firstLine = text.split("\n")[0] ?? text;
  if (firstLine.length <= maxLen) return firstLine;
  return firstLine.slice(0, maxLen - 1) + "…";
}

/**
 * Shorten a file path for display. Keeps the filename and enough
 * parent context to be useful, collapsing long prefixes.
 */
function shortPath(path: string): string {
  if (path.length <= MAX_INDICATOR_DETAIL) return path;
  // Keep last 2 segments + filename
  const parts = path.split("/");
  if (parts.length <= 3) return truncate(path, MAX_INDICATOR_DETAIL);
  const tail = parts.slice(-3).join("/");
  return `…/${tail}`;
}

function formatRange(offset: number | undefined, limit: number | undefined): string {
  if (offset == null && limit == null) return "";
  if (offset != null && limit != null) return ` [${offset}:${offset + limit}]`;
  if (offset != null) return ` [${offset}:]`;
  return ` [:${limit}]`;
}

/**
 * Parse a bash tool result to extract exit code and output summary.
 * Bash results have the format: "Exit code: N\n..." or just output text.
 */
function parseBashResult(content: string): string {
  const parts: string[] = [];

  // Check for exit code
  const exitMatch = content.match(/^Exit code: (\d+)/m);
  if (exitMatch) {
    const code = exitMatch[1];
    if (code !== "0") parts.push(`exit ${code}`);
  }

  // Count non-empty output lines (excluding the exit code line itself)
  const outputLines = content.split("\n")
    .filter(l => !l.startsWith("Exit code:") && l.trim())
    .length;

  if (outputLines > 0) {
    parts.push(`${outputLines} line${outputLines !== 1 ? "s" : ""}`);
  }

  return parts.length > 0 ? ` (${parts.join(", ")})` : "";
}

/**
 * Parse a web_fetch result to extract status code and size.
 */
function parseWebResult(content: string): string {
  const parts: string[] = [];

  // Check for "Status: NNN" pattern
  const statusMatch = content.match(/^Status: (\d+)/m);
  if (statusMatch) {
    parts.push(statusMatch[1]!);
  }

  // Content size
  const size = content.length;
  if (size >= 1000) {
    parts.push(`${(size / 1000).toFixed(1)}k chars`);
  }

  return parts.length > 0 ? ` (${parts.join(", ")})` : "";
}

/**
 * Extract a short error snippet from tool result content.
 */
function extractErrorSnippet(content: string): string {
  // Take the first meaningful line
  const lines = content.split("\n").filter(l => l.trim());
  const first = lines[0] ?? "error";
  return truncate(first, 50);
}

// ---------------------------------------------------------------------------
// Tracked Telegram Message — one message we can send and edit
// ---------------------------------------------------------------------------

/**
 * A single tracked Telegram message that can be created and edited.
 * Handles HTML formatting with plain-text fallback.
 */
class TrackedMessage {
  private messageId: number | null = null;
  private lastEditedText = "";
  private lastEditTime = 0;

  constructor(
    private readonly chatId: number,
    private readonly callApi: TelegramApiCall,
  ) {}

  /** Send a new message. Returns the message ID. */
  async send(text: string): Promise<number> {
    const truncated = text.slice(0, MAX_MESSAGE_LENGTH);
    const formatted = markdownToHtml(truncated);

    try {
      const result = await this.callApi<SentMessage>("sendMessage", {
        chat_id: this.chatId,
        text: formatted.text,
        ...(formatted.parseMode ? { parse_mode: formatted.parseMode } : {}),
      });
      this.messageId = result.message_id;
      this.lastEditedText = truncated;
      this.lastEditTime = Date.now();
      return result.message_id;
    } catch {
      // HTML formatting failed — fall back to plain text
      const result = await this.callApi<SentMessage>("sendMessage", {
        chat_id: this.chatId,
        text: truncated,
      });
      this.messageId = result.message_id;
      this.lastEditedText = truncated;
      this.lastEditTime = Date.now();
      return result.message_id;
    }
  }

  /** Edit the message content. No-op if text unchanged. */
  async edit(text: string): Promise<void> {
    const truncated = text.slice(0, MAX_MESSAGE_LENGTH);
    if (!this.messageId || truncated === this.lastEditedText) return;

    const formatted = markdownToHtml(truncated);
    try {
      await this.callApi("editMessageText", {
        chat_id: this.chatId,
        message_id: this.messageId,
        text: formatted.text,
        ...(formatted.parseMode ? { parse_mode: formatted.parseMode } : {}),
      });
      this.lastEditedText = truncated;
      this.lastEditTime = Date.now();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("not modified")) return;

      // HTML parse error — retry as plain text
      try {
        await this.callApi("editMessageText", {
          chat_id: this.chatId,
          message_id: this.messageId,
          text: truncated,
        });
        this.lastEditedText = truncated;
        this.lastEditTime = Date.now();
      } catch (err2) {
        const msg2 = err2 instanceof Error ? err2.message : String(err2);
        if (!msg2.includes("not modified")) throw err2;
      }
    }
  }

  /** Send a new message with plain text (no formatting). */
  async sendPlain(text: string): Promise<number> {
    const truncated = text.slice(0, MAX_MESSAGE_LENGTH);
    const result = await this.callApi<SentMessage>("sendMessage", {
      chat_id: this.chatId,
      text: truncated,
    });
    this.messageId = result.message_id;
    this.lastEditedText = truncated;
    this.lastEditTime = Date.now();
    return result.message_id;
  }

  /** Edit the message with plain text (no formatting). */
  async editPlain(text: string): Promise<void> {
    const truncated = text.slice(0, MAX_MESSAGE_LENGTH);
    if (!this.messageId || truncated === this.lastEditedText) return;

    try {
      await this.callApi("editMessageText", {
        chat_id: this.chatId,
        message_id: this.messageId,
        text: truncated,
      });
      this.lastEditedText = truncated;
      this.lastEditTime = Date.now();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("not modified")) throw err;
    }
  }

  getMessageId(): number | null { return this.messageId; }
  getLastEditTime(): number { return this.lastEditTime; }
  getLastEditedText(): string { return this.lastEditedText; }
}

// ---------------------------------------------------------------------------
// Streaming Message — orchestrates multiple TrackedMessages
// ---------------------------------------------------------------------------

/** Stored info about an active tool call */
interface ActiveToolCall {
  toolName: string;
  indicator: string;
  message: TrackedMessage;
}

export class StreamingMessage {
  private readonly chatId: number;
  private readonly editIntervalMs: number;
  private readonly callApi: TelegramApiCall;

  // Current text message being streamed
  private currentTextMsg: TrackedMessage | null = null;
  private currentText = "";
  private editTimer: ReturnType<typeof setTimeout> | null = null;
  private lastEditTime = 0;

  // Tool tracking: each tool gets its own message
  private activeToolCalls = new Map<string, ActiveToolCall>();

  // Track all text we've sent (for getFullText)
  private allTextParts: string[] = [];

  constructor(options: StreamingMessageOptions) {
    this.chatId = options.chatId;
    this.editIntervalMs = options.editIntervalMs ?? 1500;
    this.callApi = options.callApi;
  }

  /**
   * Show a thinking block as its own message.
   * Sent as a complete block (not streamed), formatted with 💭.
   */
  async showThinking(thinkingText: string): Promise<void> {
    if (!thinkingText.trim()) return;

    // Finalize any in-progress text message first
    await this.finalizeCurrentText();

    // Truncate thinking for display — it can be very long
    const maxThinkingLen = MAX_MESSAGE_LENGTH - 20; // room for header
    let display = thinkingText;
    if (display.length > maxThinkingLen) {
      display = display.slice(0, maxThinkingLen - 20) + "\n\n[…truncated]";
    }

    const msg = new TrackedMessage(this.chatId, this.callApi);
    try {
      await msg.send(`💭 <i>${escapeHtml(display)}</i>`);
    } catch {
      // If HTML fails, try plain
      try {
        await msg.sendPlain(`💭 ${display}`);
      } catch {
        // Silently ignore — thinking display is best-effort
      }
    }
  }

  /** Append text and schedule a throttled edit to the current text message */
  appendText(delta: string): void {
    this.currentText += delta;
    this.scheduleEdit();
  }

  /**
   * Show that a tool call is in progress.
   * Each tool gets its own dedicated Telegram message.
   * Finalizes any in-progress text message first.
   */
  async showToolCall(
    toolName: string,
    toolId: string | undefined,
    input: Record<string, unknown> = {},
  ): Promise<void> {
    const id = toolId ?? toolName;

    // Finalize any in-progress text message before showing tool
    await this.finalizeCurrentText();

    const indicator = formatToolIndicator(toolName, input);
    const pendingText = `${indicator} ⏳`;

    const msg = new TrackedMessage(this.chatId, this.callApi);
    try {
      await msg.sendPlain(pendingText);
    } catch {
      // Silently ignore — tool indicator is best-effort
      return;
    }

    this.activeToolCalls.set(id, { toolName, indicator, message: msg });
  }

  /**
   * Mark a tool call as complete.
   * Edits that tool's dedicated message to show the outcome.
   */
  showToolResult(toolId: string, isError: boolean, content: string = ""): void {
    const info = this.activeToolCalls.get(toolId);
    if (!info) return;
    this.activeToolCalls.delete(toolId);

    const outcome = formatToolResultOutcome(info.toolName, content, isError);
    const completedText = `${info.indicator} → ${outcome}`;

    // Fire-and-forget the edit — don't block the stream
    info.message.editPlain(completedText).catch(() => {});
  }

  /** Get the full accumulated text across all text messages */
  getFullText(): string {
    const parts = [...this.allTextParts];
    if (this.currentText.trim()) {
      parts.push(this.currentText);
    }
    return parts.join("\n\n");
  }

  /** Get the current text message's content */
  getText(): string {
    return this.currentText;
  }

  /** Flush any pending text edits immediately */
  async flush(): Promise<void> {
    if (this.editTimer) {
      clearTimeout(this.editTimer);
      this.editTimer = null;
    }

    if (this.currentText.trim()) {
      await this.doTextEdit();
    }
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  /**
   * Finalize the current text message (if any) and prepare for a new one.
   * Called before tool calls or thinking blocks to ensure clean separation.
   */
  private async finalizeCurrentText(): Promise<void> {
    if (this.editTimer) {
      clearTimeout(this.editTimer);
      this.editTimer = null;
    }

    if (this.currentText.trim()) {
      await this.doTextEdit();
      this.allTextParts.push(this.currentText);
    }

    // Reset for next text block
    this.currentTextMsg = null;
    this.currentText = "";
  }

  private scheduleEdit(): void {
    if (this.editTimer) return;

    const elapsed = Date.now() - this.lastEditTime;
    const delay = Math.max(0, this.editIntervalMs - elapsed);

    this.editTimer = setTimeout(async () => {
      this.editTimer = null;
      await this.doTextEdit();
    }, delay);
  }

  private async doTextEdit(): Promise<void> {
    const text = this.currentText.trim();
    if (!text) return;

    try {
      if (!this.currentTextMsg) {
        // First text in this block — create a new message
        this.currentTextMsg = new TrackedMessage(this.chatId, this.callApi);

        if (text.length > MAX_MESSAGE_LENGTH) {
          // Text already exceeds limit — send what fits, prepare overflow
          await this.currentTextMsg.send(text.slice(0, MAX_MESSAGE_LENGTH));
          await this.handleOverflow(text);
        } else {
          await this.currentTextMsg.send(text);
        }
      } else if (text.length > MAX_MESSAGE_LENGTH) {
        // Text grew past the limit — handle overflow
        await this.handleOverflow(text);
      } else {
        // Normal edit — update the existing message
        await this.currentTextMsg.edit(text);
      }

      this.lastEditTime = Date.now();
    } catch {
      // Silently ignore edit errors
    }
  }

  private async handleOverflow(text: string): Promise<void> {
    // Finalize the current message with what it already has
    const currentEdited = this.currentTextMsg?.getLastEditedText() ?? "";
    if (currentEdited) {
      this.allTextParts.push(currentEdited);
    }

    // Start a new message with the overflow
    const overflow = text.slice(currentEdited.length).trim();
    if (overflow) {
      this.currentTextMsg = new TrackedMessage(this.chatId, this.callApi);
      const chunk = overflow.slice(0, MAX_MESSAGE_LENGTH);
      await this.currentTextMsg.send(chunk);
      // Update currentText to just the overflow portion
      this.currentText = overflow;
    }
  }
}
