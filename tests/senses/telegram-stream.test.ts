// ---------------------------------------------------------------------------
// Tests for Telegram Streaming Message — Rich Tool Indicators & HTML
// ---------------------------------------------------------------------------

import { describe, expect, test } from "bun:test";
import {
  formatToolIndicator,
  formatToolOutcome,
  formatToolResultOutcome,
  escapeHtml,
  markdownToHtml,
  StreamingMessage,
} from "../../src/senses/telegram-stream.ts";
import type { TelegramApiCall } from "../../src/senses/telegram-stream.ts";

// ---------------------------------------------------------------------------
// escapeHtml
// ---------------------------------------------------------------------------

describe("escapeHtml", () => {
  test("escapes angle brackets", () => {
    expect(escapeHtml("<div>test</div>")).toBe("&lt;div&gt;test&lt;/div&gt;");
  });

  test("escapes ampersand", () => {
    expect(escapeHtml("a & b")).toBe("a &amp; b");
  });

  test("escapes quotes", () => {
    expect(escapeHtml('say "hello"')).toBe("say &quot;hello&quot;");
  });

  test("passes through plain text", () => {
    expect(escapeHtml("Hello World 123")).toBe("Hello World 123");
  });

  test("handles empty string", () => {
    expect(escapeHtml("")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// markdownToHtml
// ---------------------------------------------------------------------------

describe("markdownToHtml", () => {
  test("converts bold **text**", () => {
    const result = markdownToHtml("Hello **world**!");
    expect(result.parseMode).toBe("HTML");
    expect(result.text).toContain("<b>world</b>");
  });

  test("converts bold __text__", () => {
    const result = markdownToHtml("Hello __world__!");
    expect(result.text).toContain("<b>world</b>");
  });

  test("converts italic *text*", () => {
    const result = markdownToHtml("Hello *world*!");
    expect(result.text).toContain("<i>world</i>");
  });

  test("converts inline code", () => {
    const result = markdownToHtml("Run `ls -la` now");
    expect(result.text).toContain("<code>ls -la</code>");
  });

  test("converts code blocks", () => {
    const result = markdownToHtml("Here:\n```\nsome code\n```\nDone");
    expect(result.text).toContain("<pre>some code\n</pre>");
  });

  test("escapes HTML in non-code text", () => {
    const result = markdownToHtml("Use <br> for breaks");
    expect(result.text).toContain("&lt;br&gt;");
  });

  test("converts headings to bold", () => {
    const result = markdownToHtml("# Title\nSome text");
    expect(result.text).toContain("<b>Title</b>");
  });

  test("plain text gets HTML parse mode", () => {
    const result = markdownToHtml("Just plain text");
    expect(result.parseMode).toBe("HTML");
  });

  test("code blocks protect their content from other transforms", () => {
    const result = markdownToHtml("```\n**not bold** & <safe>\n```");
    expect(result.text).not.toContain("<b>");
    expect(result.text).toContain("&amp;");
    expect(result.text).toContain("&lt;safe&gt;");
  });

  test("inline code protects content from formatting", () => {
    const result = markdownToHtml("Run `**not bold**` here");
    expect(result.text).toContain("<code>");
    // The content inside code should be escaped, not bold
    expect(result.text).not.toContain("<b>not bold</b>");
  });

  // --- New Telegram HTML features ---

  test("converts strikethrough ~~text~~", () => {
    const result = markdownToHtml("This is ~~deleted~~ text");
    expect(result.text).toContain("<s>deleted</s>");
  });

  test("converts blockquotes", () => {
    const result = markdownToHtml("> This is a quote\n> Second line");
    expect(result.text).toContain("<blockquote>");
    expect(result.text).toContain("This is a quote");
    expect(result.text).toContain("Second line");
    expect(result.text).toContain("</blockquote>");
  });

  test("converts bullet lists with - to bullets", () => {
    const result = markdownToHtml("- Item 1\n- Item 2\n- Item 3");
    expect(result.text).toContain("• Item 1");
    expect(result.text).toContain("• Item 2");
    expect(result.text).toContain("• Item 3");
  });

  test("converts bullet lists with * to bullets", () => {
    const result = markdownToHtml("* Alpha\n* Beta");
    expect(result.text).toContain("• Alpha");
    expect(result.text).toContain("• Beta");
  });

  test("converts horizontal rules to em dash line", () => {
    const result = markdownToHtml("Above\n\n---\n\nBelow");
    expect(result.text).toContain("———");
    expect(result.text).not.toContain("---");
  });

  test("code blocks with language get syntax class", () => {
    const result = markdownToHtml("```typescript\nconst x = 1;\n```");
    expect(result.text).toContain('class="language-typescript"');
    expect(result.text).toContain("<pre><code");
    expect(result.text).toContain("const x = 1;");
  });

  test("code blocks without language use plain pre", () => {
    const result = markdownToHtml("```\nplain code\n```");
    expect(result.text).toContain("<pre>plain code");
    expect(result.text).not.toContain("<code");
  });

  test("complex mixed markdown", () => {
    const input = "## Status\n\n**Bold** and ~~old~~\n\n> Note here\n\n- Item one\n- Item two";
    const result = markdownToHtml(input);
    expect(result.text).toContain("<b>Status</b>");
    expect(result.text).toContain("<b>Bold</b>");
    expect(result.text).toContain("<s>old</s>");
    expect(result.text).toContain("<blockquote>");
    expect(result.text).toContain("• Item one");
  });
});

// ---------------------------------------------------------------------------
// formatToolIndicator
// ---------------------------------------------------------------------------

describe("formatToolIndicator", () => {
  test("bash: shows command with wrench icon", () => {
    const result = formatToolIndicator("bash", { command: "git log --oneline -10" });
    expect(result).toBe("🔧 git log --oneline -10");
  });

  test("bash: truncates long commands", () => {
    const longCmd = "find / -name '*.ts' -type f -exec grep -l 'something very specific and long' {} \\;";
    const result = formatToolIndicator("bash", { command: longCmd });
    expect(result).toContain("🔧 ");
    expect(result).toContain("…");
    expect(result.length).toBeLessThanOrEqual(65); // icon + space + 60 + some buffer
  });

  test("bash: shows (pty) for interactive mode", () => {
    const result = formatToolIndicator("bash", { command: "vim file.ts", interactive: true });
    expect(result).toBe("🔧 vim file.ts (pty)");
  });

  test("bash: takes only first line of multi-line command", () => {
    const result = formatToolIndicator("bash", { command: "echo hello\necho world" });
    expect(result).toBe("🔧 echo hello");
  });

  test("read_file: shows path with document icon", () => {
    const result = formatToolIndicator("read_file", { path: "/opt/jarvis/src/daemon.ts" });
    expect(result).toBe("📄 /opt/jarvis/src/daemon.ts");
  });

  test("read_file: shows line range when offset and limit given", () => {
    const result = formatToolIndicator("read_file", { path: "/opt/jarvis/src/daemon.ts", offset: 10, limit: 20 });
    expect(result).toBe("📄 /opt/jarvis/src/daemon.ts [10:30]");
  });

  test("read_file: shows open range with offset only", () => {
    const result = formatToolIndicator("read_file", { path: "/some/file.ts", offset: 50 });
    expect(result).toBe("📄 /some/file.ts [50:]");
  });

  test("read_file: shows limit-only range", () => {
    const result = formatToolIndicator("read_file", { path: "/some/file.ts", limit: 10 });
    expect(result).toBe("📄 /some/file.ts [:10]");
  });

  test("read_file: shortens very long paths", () => {
    const longPath = "/opt/jarvis/src/some/deeply/nested/directory/structure/file.ts";
    const result = formatToolIndicator("read_file", { path: longPath });
    expect(result).toContain("📄 ");
    expect(result).toContain("file.ts");
    expect(result).toContain("…/");
  });

  test("write_file: shows path and character count", () => {
    const result = formatToolIndicator("write_file", {
      path: "/opt/jarvis/src/config.ts",
      content: "x".repeat(500),
    });
    expect(result).toBe("✏️ /opt/jarvis/src/config.ts (500 chars)");
  });

  test("write_file: shows k for large content", () => {
    const result = formatToolIndicator("write_file", {
      path: "/opt/jarvis/src/config.ts",
      content: "x".repeat(5000),
    });
    expect(result).toBe("✏️ /opt/jarvis/src/config.ts (5.0k chars)");
  });

  test("ssh_exec: shows host and command", () => {
    const result = formatToolIndicator("ssh_exec", { host: "mac-mini", command: "ls -la" });
    expect(result).toBe("🖥️ mac-mini → ls -la");
  });

  test("ssh_exec: shows user@host format", () => {
    const result = formatToolIndicator("ssh_exec", { host: "rusty@mac-mini", command: "uptime" });
    expect(result).toBe("🖥️ rusty@mac-mini → uptime");
  });

  test("web_fetch: shows method and URL", () => {
    const result = formatToolIndicator("web_fetch", { url: "https://api.example.com/status" });
    expect(result).toBe("🌐 GET https://api.example.com/status");
  });

  test("web_fetch: shows POST method", () => {
    const result = formatToolIndicator("web_fetch", { url: "https://api.example.com/data", method: "POST" });
    expect(result).toBe("🌐 POST https://api.example.com/data");
  });

  test("web_fetch: truncates long URLs", () => {
    const longUrl = "https://api.example.com/very/long/path/that/goes/on/and/on/forever/to/test/truncation";
    const result = formatToolIndicator("web_fetch", { url: longUrl });
    expect(result).toContain("🌐 GET ");
    expect(result).toContain("…");
  });

  test("cron_manage: shows action", () => {
    const result = formatToolIndicator("cron_manage", { action: "list" });
    expect(result).toBe("⏰ cron list");
  });

  test("cron_manage: shows action with id", () => {
    const result = formatToolIndicator("cron_manage", { action: "add", id: "morning-check" });
    expect(result).toBe("⏰ cron add: morning-check");
  });

  test("cron_manage: shows remove with id", () => {
    const result = formatToolIndicator("cron_manage", { action: "remove", id: "old-task" });
    expect(result).toBe("⏰ cron remove: old-task");
  });

  test("unknown tool: shows gear icon and name", () => {
    const result = formatToolIndicator("some_new_tool", { foo: "bar" });
    expect(result).toBe("⚙️ some_new_tool");
  });

  test("handles missing input fields gracefully", () => {
    expect(formatToolIndicator("bash", {})).toBe("🔧 ");
    expect(formatToolIndicator("read_file", {})).toBe("📄 ");
    expect(formatToolIndicator("web_fetch", {})).toBe("🌐 GET ");
  });
});

// ---------------------------------------------------------------------------
// formatToolOutcome (backward compat — icon + outcome)
// ---------------------------------------------------------------------------

describe("formatToolOutcome", () => {
  test("bash: success with output lines", () => {
    const content = "Exit code: 0\nline 1\nline 2\nline 3";
    const result = formatToolOutcome("bash", content, false);
    expect(result).toBe("🔧 ✓ (3 lines)");
  });

  test("bash: success with non-zero exit code", () => {
    const content = "Exit code: 1\nerror: something failed";
    const result = formatToolOutcome("bash", content, false);
    expect(result).toBe("🔧 ✓ (exit 1, 1 line)");
  });

  test("bash: success with no output", () => {
    const content = "Exit code: 0\n";
    const result = formatToolOutcome("bash", content, false);
    expect(result).toBe("🔧 ✓");
  });

  test("bash: error shows snippet", () => {
    const result = formatToolOutcome("bash", "command not found: foobar", true);
    expect(result).toBe("🔧 ✗ command not found: foobar");
  });

  test("read_file: shows line count", () => {
    const content = "line1\nline2\nline3\nline4\nline5";
    const result = formatToolOutcome("read_file", content, false);
    expect(result).toBe("📄 ✓ 5 lines");
  });

  test("read_file: single line", () => {
    const result = formatToolOutcome("read_file", "single line", false);
    expect(result).toBe("📄 ✓ 1 line");
  });

  test("write_file: shows saved", () => {
    const result = formatToolOutcome("write_file", "Written to /path/file.ts", false);
    expect(result).toBe("✏️ ✓ saved");
  });

  test("ssh_exec: shows line count", () => {
    const content = "output line 1\noutput line 2\n";
    const result = formatToolOutcome("ssh_exec", content, false);
    expect(result).toBe("🖥️ ✓ 2 lines");
  });

  test("ssh_exec: empty output", () => {
    const result = formatToolOutcome("ssh_exec", "", false);
    expect(result).toBe("🖥️ ✓");
  });

  test("web_fetch: shows status and size", () => {
    const content = "Status: 200\n" + "x".repeat(5000);
    const result = formatToolOutcome("web_fetch", content, false);
    expect(result).toContain("🌐 ✓");
    expect(result).toContain("200");
    expect(result).toContain("k chars");
  });

  test("web_fetch: small response", () => {
    const content = "Status: 200\n{\"ok\": true}";
    const result = formatToolOutcome("web_fetch", content, false);
    expect(result).toBe("🌐 ✓ (200)");
  });

  test("cron_manage: success", () => {
    const result = formatToolOutcome("cron_manage", "OK", false);
    expect(result).toBe("⏰ ✓");
  });

  test("error: truncates long error messages", () => {
    const longError = "This is a very long error message that should be truncated because it is too long for the indicator";
    const result = formatToolOutcome("bash", longError, true);
    expect(result).toContain("🔧 ✗ ");
    expect(result).toContain("…");
  });

  test("error: shows first line of multi-line error", () => {
    const result = formatToolOutcome("bash", "main error\nstack trace\nmore details", true);
    expect(result).toBe("🔧 ✗ main error");
  });

  test("unknown tool: shows generic success", () => {
    const result = formatToolOutcome("new_tool", "some output", false);
    expect(result).toBe("⚙️ ✓");
  });
});

// ---------------------------------------------------------------------------
// formatToolResultOutcome (just the outcome, no icon)
// ---------------------------------------------------------------------------

describe("formatToolResultOutcome", () => {
  test("bash success: shows line count", () => {
    const result = formatToolResultOutcome("bash", "Exit code: 0\nhello\nworld\n", false);
    expect(result).toBe("✓ (2 lines)");
  });

  test("bash error: shows snippet", () => {
    const result = formatToolResultOutcome("bash", "command not found", true);
    expect(result).toBe("✗ command not found");
  });

  test("read_file: shows line count", () => {
    const result = formatToolResultOutcome("read_file", "a\nb\nc", false);
    expect(result).toBe("✓ 3 lines");
  });

  test("write_file: saved", () => {
    const result = formatToolResultOutcome("write_file", "ok", false);
    expect(result).toBe("✓ saved");
  });
});

// ---------------------------------------------------------------------------
// StreamingMessage — One Message Per Content Unit Architecture
// ---------------------------------------------------------------------------
//
// In the current design, each content type gets its own Telegram message:
//   - Text → streamed via edits to a single message
//   - Tool calls → each tool gets its own message with pending/completed state
//   - Thinking → its own message with 💭 prefix
//
// getText() returns only the current text content.
// Tool indicators live in their own separate messages.
// ---------------------------------------------------------------------------

describe("StreamingMessage", () => {
  function createTestStream() {
    const apiCalls: { method: string; params: Record<string, unknown> }[] = [];
    const mockApi: TelegramApiCall = async <T>(method: string, params: Record<string, unknown>): Promise<T> => {
      apiCalls.push({ method, params });
      if (method === "sendMessage") {
        return { message_id: apiCalls.length, chat: { id: 123 } } as T;
      }
      return {} as T;
    };

    const stream = new StreamingMessage({
      chatId: 123,
      editIntervalMs: 10, // fast for tests
      callApi: mockApi,
    });

    return { stream, apiCalls };
  }

  test("showToolCall sends a separate message with pending marker", async () => {
    const { stream, apiCalls } = createTestStream();

    await stream.showToolCall("bash", "tool-1", { command: "ls -la" });

    // Tool indicator should be sent as its own message (plain text)
    const sendCalls = apiCalls.filter(c => c.method === "sendMessage");
    expect(sendCalls.length).toBe(1);
    expect(String(sendCalls[0]!.params["text"])).toContain("🔧 ls -la ⏳");

    // getText() should be empty — tool is in its own message
    expect(stream.getText()).toBe("");
  });

  test("showToolResult edits the tool's own message with outcome", async () => {
    const { stream, apiCalls } = createTestStream();

    stream.appendText("Hello ");
    await stream.showToolCall("bash", "tool-1", { command: "echo hello" });

    // Simulate result — edits the tool's dedicated message
    stream.showToolResult("tool-1", false, "Exit code: 0\nhello\n");

    // Wait a tick for the fire-and-forget edit
    await new Promise(r => setTimeout(r, 20));

    // Should have an editMessageText call for the tool message
    const editCalls = apiCalls.filter(c => c.method === "editMessageText");
    expect(editCalls.length).toBeGreaterThanOrEqual(1);
    const toolEdit = editCalls.find(c =>
      String(c.params["text"]).includes("🔧 echo hello → ✓")
    );
    expect(toolEdit).toBeTruthy();
    expect(String(toolEdit!.params["text"])).not.toContain("⏳");
  });

  test("showToolResult handles errors with indicator → error", async () => {
    const { stream, apiCalls } = createTestStream();

    await stream.showToolCall("read_file", "tool-2", { path: "/nonexistent" });
    stream.showToolResult("tool-2", true, "File not found: /nonexistent");

    // Wait a tick for the fire-and-forget edit
    await new Promise(r => setTimeout(r, 20));

    const editCalls = apiCalls.filter(c => c.method === "editMessageText");
    const toolEdit = editCalls.find(c =>
      String(c.params["text"]).includes("📄 /nonexistent → ✗")
    );
    expect(toolEdit).toBeTruthy();
    expect(String(toolEdit!.params["text"])).not.toContain("⏳");
  });

  test("multiple tool calls get independent messages", async () => {
    const { stream, apiCalls } = createTestStream();

    await stream.showToolCall("bash", "t1", { command: "whoami" });
    await stream.showToolCall("read_file", "t2", { path: "/etc/hosts" });

    // Each tool gets its own sendMessage
    const sendCalls = apiCalls.filter(c => c.method === "sendMessage");
    expect(sendCalls.length).toBe(2);
    expect(String(sendCalls[0]!.params["text"])).toContain("🔧 whoami ⏳");
    expect(String(sendCalls[1]!.params["text"])).toContain("📄 /etc/hosts ⏳");

    // Resolve first tool — only its message gets edited
    stream.showToolResult("t1", false, "Exit code: 0\nrusty\n");
    await new Promise(r => setTimeout(r, 20));

    const editCalls = apiCalls.filter(c => c.method === "editMessageText");
    const t1Edit = editCalls.find(c =>
      String(c.params["text"]).includes("🔧 whoami → ✓")
    );
    expect(t1Edit).toBeTruthy();
  });

  test("showToolCall with no input defaults gracefully", async () => {
    const { stream, apiCalls } = createTestStream();
    await stream.showToolCall("bash", "t1");

    const sendCalls = apiCalls.filter(c => c.method === "sendMessage");
    expect(sendCalls.length).toBe(1);
    expect(String(sendCalls[0]!.params["text"])).toContain("🔧");
    expect(String(sendCalls[0]!.params["text"])).toContain("⏳");
  });

  test("flush sends accumulated text", async () => {
    const { stream, apiCalls } = createTestStream();

    stream.appendText("Hello world");
    await stream.flush();

    expect(apiCalls.length).toBeGreaterThan(0);
    const sendCall = apiCalls.find(c => c.method === "sendMessage");
    expect(sendCall).toBeTruthy();
    // Should be sent with HTML parse mode
    expect(sendCall!.params["parse_mode"]).toBe("HTML");
  });

  test("tool block starts new message after text", async () => {
    const { stream, apiCalls } = createTestStream();

    // First, stream some text
    stream.appendText("Let me check that...");
    await stream.flush();

    // Now a tool starts — should start a new message
    await stream.showToolCall("bash", "t1", { command: "ls -la" });
    await stream.flush();

    // Should have sent at least 2 messages
    const sendCalls = apiCalls.filter(c => c.method === "sendMessage");
    expect(sendCalls.length).toBe(2);

    // First message = text only
    const firstText = String(sendCalls[0]!.params["text"]);
    expect(firstText).toContain("Let me check that");
    expect(firstText).not.toContain("🔧");

    // Second message = tool indicator
    const secondText = String(sendCalls[1]!.params["text"]);
    expect(secondText).toContain("🔧 ls -la ⏳");
  });

  test("text after tools starts a new text message", async () => {
    const { stream, apiCalls } = createTestStream();

    await stream.showToolCall("bash", "t1", { command: "ls" });
    stream.showToolResult("t1", false, "Exit code: 0\nfile1\nfile2\n");

    // Now text arrives after tool block — should start a fresh text message
    stream.appendText("Here are the files:");
    await stream.flush();

    // getText returns the current text content (not tool indicators)
    const text = stream.getText();
    expect(text).toContain("Here are the files:");

    // Tool and text should be in separate messages
    const sendCalls = apiCalls.filter(c => c.method === "sendMessage");
    expect(sendCalls.length).toBe(2); // 1 tool + 1 text
  });

  test("getFullText includes text from before tool block", async () => {
    const { stream } = createTestStream();

    stream.appendText("Checking...");
    await stream.flush();

    await stream.showToolCall("bash", "t1", { command: "ls" });
    stream.showToolResult("t1", false, "Exit code: 0\nok\n");
    stream.appendText("Done!");

    const fullText = stream.getFullText();
    expect(fullText).toContain("Checking...");
    expect(fullText).toContain("Done!");
  });
});
