// ---------------------------------------------------------------------------
// PTY-Capable Shell Execution
// ---------------------------------------------------------------------------
//
// THE FOUNDATION. With a real terminal, Jarvis can use ANY human tool —
// interactive CLIs, TUIs, Claude Code sessions, package managers, anything.
//
// Two modes:
//   execBash()        — Non-interactive. Bun.spawn with piped stdout/stderr.
//   execInteractive() — PTY-allocated via system `script` command (zero deps).
//
// The `script` command forces PTY allocation without node-pty or FFI.
// macOS: script -q /dev/null bash -c "cmd"
// Linux: script -qc "cmd" /dev/null
// ---------------------------------------------------------------------------

import { platform } from "node:os";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BashOptions {
  /** Timeout in milliseconds (default: 30s) */
  timeout_ms?: number;
  /** Working directory */
  working_dir?: string;
  /** Additional environment variables */
  env?: Record<string, string>;
  /** Text to write to stdin before closing */
  stdin_text?: string;
}

export interface BashResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_CHARS = 100_000;

// ---------------------------------------------------------------------------
// ANSI Stripping
// ---------------------------------------------------------------------------

/**
 * Strip ANSI escape sequences from terminal output.
 * Handles SGR (colors), cursor movement, erase, OSC (title), and CSI sequences.
 */
export function stripAnsi(text: string): string {
  return text
    .replace(/\x1b\[[?]?[0-9;]*[A-Za-z]/g, "")  // CSI sequences incl. DEC private modes (?25h, ?2004h)
    .replace(/\x1b\][^\x07]*\x07/g, "")           // OSC sequences (terminal title, etc.)
    .replace(/\x1b\(B/g, "")                       // Character set selection
    .replace(/\r\n/g, "\n")                         // Normalize line endings
    .replace(/\r/g, "");                            // Strip lone carriage returns
}

// ---------------------------------------------------------------------------
// Output Truncation
// ---------------------------------------------------------------------------

/**
 * Truncate long output, keeping head and tail with a notice in the middle.
 */
export function truncateOutput(text: string, maxChars: number = MAX_OUTPUT_CHARS): string {
  if (text.length <= maxChars) return text;
  const half = Math.floor(maxChars / 2);
  const omitted = text.length - maxChars;
  return (
    text.slice(0, half) +
    `\n\n[... truncated ${omitted} characters ...]\n\n` +
    text.slice(-half)
  );
}

// ---------------------------------------------------------------------------
// Non-Interactive Execution
// ---------------------------------------------------------------------------

/**
 * Execute a shell command non-interactively.
 * Uses Bun.spawn with piped stdout/stderr. Suitable for simple commands
 * that don't require a TTY.
 */
export async function execBash(command: string, opts: BashOptions = {}): Promise<BashResult> {
  const timeout = opts.timeout_ms ?? DEFAULT_TIMEOUT_MS;
  const cwd = opts.working_dir ?? process.cwd();
  const env = { ...process.env, ...opts.env };

  const proc = Bun.spawn(["bash", "-c", command], {
    stdout: "pipe",
    stderr: "pipe",
    stdin: opts.stdin_text ? "pipe" : undefined,
    cwd,
    env,
  });

  // Feed stdin if provided (Bun's proc.stdin is a FileSink, not WritableStream)
  if (opts.stdin_text && proc.stdin) {
    proc.stdin.write(opts.stdin_text);
    proc.stdin.end();
  }

  // Race between completion and timeout
  let timedOut = false;
  const timer = timeout > 0
    ? setTimeout(() => {
        timedOut = true;
        proc.kill();
      }, timeout)
    : null;

  try {
    const [exitCode, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);

    return {
      stdout: truncateOutput(stdout),
      stderr: truncateOutput(stderr),
      exitCode: timedOut ? 124 : exitCode,
      timedOut,
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Interactive (PTY) Execution
// ---------------------------------------------------------------------------

/**
 * Execute a command with PTY allocation via the system `script` command.
 * This forces a real pseudo-terminal without any npm dependencies.
 *
 * The output will contain ANSI escape codes since it's going through a PTY.
 * Use stripAnsi() on the result if you need clean text.
 */
export async function execInteractive(command: string, opts: BashOptions = {}): Promise<BashResult> {
  const timeout = opts.timeout_ms ?? DEFAULT_TIMEOUT_MS;
  const cwd = opts.working_dir ?? process.cwd();
  const env = { ...process.env, ...opts.env, TERM: "xterm-256color" };

  // Build the PTY-wrapped command using `script`
  // macOS: script -q /dev/null bash -c "cmd"
  // Linux: script -qc "cmd" /dev/null
  const os = platform();
  const args =
    os === "darwin"
      ? ["script", "-q", "/dev/null", "bash", "-c", command]
      : ["script", "-qc", command, "/dev/null"];

  const proc = Bun.spawn(args, {
    stdout: "pipe",
    stderr: "pipe",
    stdin: opts.stdin_text ? "pipe" : undefined,
    cwd,
    env,
  });

  // Feed stdin if provided (Bun's proc.stdin is a FileSink, not WritableStream)
  if (opts.stdin_text && proc.stdin) {
    proc.stdin.write(opts.stdin_text);
    proc.stdin.end();
  }

  // Race between completion and timeout
  let timedOut = false;
  const timer = timeout > 0
    ? setTimeout(() => {
        timedOut = true;
        proc.kill();
      }, timeout)
    : null;

  try {
    const [exitCode, rawOutput, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);

    return {
      stdout: truncateOutput(rawOutput),
      stderr: truncateOutput(stderr),
      exitCode: timedOut ? 124 : exitCode,
      timedOut,
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
