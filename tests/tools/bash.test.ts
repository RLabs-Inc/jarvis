import { describe, test, expect } from "bun:test";
import {
  execBash,
  execInteractive,
  stripAnsi,
  truncateOutput,
} from "../../src/tools/bash.ts";

// ---------------------------------------------------------------------------
// ANSI Stripping
// ---------------------------------------------------------------------------

describe("stripAnsi", () => {
  test("strips SGR color codes", () => {
    expect(stripAnsi("\x1b[31mred\x1b[0m")).toBe("red");
  });

  test("strips cursor movement sequences", () => {
    expect(stripAnsi("\x1b[2Jhello\x1b[H")).toBe("hello");
  });

  test("strips OSC title sequences", () => {
    expect(stripAnsi("\x1b]0;title\x07content")).toBe("content");
  });

  test("normalizes \\r\\n to \\n", () => {
    expect(stripAnsi("line1\r\nline2\r\n")).toBe("line1\nline2\n");
  });

  test("passes through clean text unchanged", () => {
    expect(stripAnsi("hello world")).toBe("hello world");
  });

  test("handles empty string", () => {
    expect(stripAnsi("")).toBe("");
  });

  test("strips DEC private mode sequences (cursor show/hide)", () => {
    // ?25h = show cursor, ?25l = hide cursor — common in PTY output
    expect(stripAnsi("\x1b[?25lhidden\x1b[?25h")).toBe("hidden");
  });

  test("strips bracketed paste mode sequences", () => {
    // ?2004h/l = enable/disable bracketed paste mode
    expect(stripAnsi("\x1b[?2004hpasted\x1b[?2004l")).toBe("pasted");
  });
});

// ---------------------------------------------------------------------------
// Output Truncation
// ---------------------------------------------------------------------------

describe("truncateOutput", () => {
  test("returns short text unchanged", () => {
    expect(truncateOutput("hello", 100)).toBe("hello");
  });

  test("truncates long text with head/tail and notice", () => {
    const input = "A".repeat(200);
    const result = truncateOutput(input, 100);
    expect(result.length).toBeLessThan(200);
    expect(result).toContain("[... truncated");
    expect(result).toContain("100 characters");
    expect(result.startsWith("A".repeat(50))).toBe(true);
    expect(result.endsWith("A".repeat(50))).toBe(true);
  });

  test("handles exact-limit text", () => {
    const input = "X".repeat(100);
    expect(truncateOutput(input, 100)).toBe(input);
  });
});

// ---------------------------------------------------------------------------
// Non-Interactive Execution
// ---------------------------------------------------------------------------

describe("execBash", () => {
  test("executes simple command and captures stdout", async () => {
    const result = await execBash("echo hello");
    expect(result.stdout.trim()).toBe("hello");
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
  });

  test("captures stderr", async () => {
    const result = await execBash("echo oops >&2");
    expect(result.stderr.trim()).toBe("oops");
    expect(result.exitCode).toBe(0);
  });

  test("returns non-zero exit code on failure", async () => {
    const result = await execBash("exit 42");
    expect(result.exitCode).toBe(42);
    expect(result.timedOut).toBe(false);
  });

  test("respects working directory", async () => {
    const result = await execBash("pwd", { working_dir: "/tmp" });
    // /tmp may be a symlink to /private/tmp on macOS
    expect(result.stdout.trim()).toMatch(/\/tmp$/);
  });

  test("respects environment variables", async () => {
    const result = await execBash('echo $JARVIS_TEST_VAR', {
      env: { JARVIS_TEST_VAR: "vessel" },
    });
    expect(result.stdout.trim()).toBe("vessel");
  });

  test("times out long-running commands", async () => {
    const result = await execBash("sleep 60", { timeout_ms: 200 });
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBe(124);
  });

  test("feeds stdin text to command", async () => {
    const result = await execBash("cat", { stdin_text: "from stdin" });
    expect(result.stdout.trim()).toBe("from stdin");
  });

  test("handles multi-line output", async () => {
    const result = await execBash('printf "line1\\nline2\\nline3"');
    expect(result.stdout).toBe("line1\nline2\nline3");
  });
});

// ---------------------------------------------------------------------------
// Interactive (PTY) Execution
// ---------------------------------------------------------------------------

describe("execInteractive", () => {
  test("executes command through PTY", async () => {
    const result = await execInteractive("echo pty-test");
    expect(stripAnsi(result.stdout)).toContain("pty-test");
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
  });

  test("PTY output contains terminal sequences (raw)", async () => {
    // PTY mode produces output through a real terminal, which may include
    // ANSI sequences. The key is that it works and we can strip them.
    const result = await execInteractive("echo hello-from-pty");
    const cleaned = stripAnsi(result.stdout);
    expect(cleaned).toContain("hello-from-pty");
  });

  test("respects timeout in interactive mode", async () => {
    const result = await execInteractive("sleep 60", { timeout_ms: 200 });
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBe(124);
  });

  test("respects working directory in interactive mode", async () => {
    const result = await execInteractive("pwd", { working_dir: "/tmp" });
    const cleaned = stripAnsi(result.stdout);
    expect(cleaned).toMatch(/\/tmp/);
  });

  test("respects environment variables in interactive mode", async () => {
    const result = await execInteractive('echo $JARVIS_PTY_TEST', {
      env: { JARVIS_PTY_TEST: "pty-value" },
    });
    const cleaned = stripAnsi(result.stdout);
    expect(cleaned).toContain("pty-value");
  });

  test("handles command that produces ANSI colors", async () => {
    // Force color output via printf with ANSI codes
    const result = await execInteractive('printf "\\033[31mred\\033[0m"');
    // Raw output should contain ANSI
    const cleaned = stripAnsi(result.stdout);
    expect(cleaned).toContain("red");
  });
});
