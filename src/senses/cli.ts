// ---------------------------------------------------------------------------
// CLI Sense — Interactive Terminal Interface
// ---------------------------------------------------------------------------
//
// The first sense: Sherlock talks to Jarvis through the terminal.
//
// Features:
//   - Readline-based input loop with prompt
//   - Streaming output (text deltas rendered as they arrive)
//   - Context stats on startup (tier token counts)
//   - Slash commands: /quit, /status, /session, /tiers
//   - Tool call display (shows what Jarvis is using)
//   - Graceful Ctrl+C handling
//
// The CLI is thin — it reads input, feeds it to the Daemon, and renders
// the ConversationEvents to stdout. The Daemon does all the real work.
// ---------------------------------------------------------------------------

import * as readline from "node:readline";
import { Daemon } from "../daemon.ts";
import type { DaemonStats } from "../daemon.ts";
import type { ConversationEvent } from "../conversation.ts";
import { validateTierBudgets } from "../context/tiers.ts";
import type { JarvisConfig } from "../config.ts";
import type { TierBudgetReport } from "../context/types.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CliOptions {
  /** Override stdout for testing */
  output?: NodeJS.WritableStream;
  /** Override stdin for testing */
  input?: NodeJS.ReadableStream;
}

// ---------------------------------------------------------------------------
// Slash Commands
// ---------------------------------------------------------------------------

/** All known slash commands */
export const SLASH_COMMANDS = ["/quit", "/status", "/session", "/tiers", "/help"] as const;
export type SlashCommand = (typeof SLASH_COMMANDS)[number];

/**
 * Parse user input into a slash command or plain text.
 * Returns { command, args } for slash commands, or null for plain text.
 */
export function parseCommand(input: string): { command: SlashCommand; args: string } | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return null;

  const spaceIdx = trimmed.indexOf(" ");
  const cmd = (spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx)).toLowerCase();
  const args = spaceIdx === -1 ? "" : trimmed.slice(spaceIdx + 1).trim();

  if (SLASH_COMMANDS.includes(cmd as SlashCommand)) {
    return { command: cmd as SlashCommand, args };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Formatting Helpers
// ---------------------------------------------------------------------------

/**
 * Format a tier budget report for terminal display.
 */
export function formatTierReport(report: TierBudgetReport): string {
  const lines: string[] = [];
  lines.push("Tier Status:");

  for (const tier of report.tiers) {
    const pct = tier.budget > 0 ? ((tier.tokens / tier.budget) * 100).toFixed(1) : "0.0";
    const bar = progressBar(tier.tokens, tier.budget, 20);
    const status = tier.status === "ok" ? "" : " [OVER]";
    lines.push(`  Tier ${tier.tier}: ${bar} ${tier.tokens.toLocaleString()}/${tier.budget.toLocaleString()} tokens (${pct}%)${status}`);
  }

  const totalPct = report.totalBudget > 0
    ? ((report.totalTokens / report.totalBudget) * 100).toFixed(1)
    : "0.0";
  lines.push(`  Total: ${report.totalTokens.toLocaleString()}/${report.totalBudget.toLocaleString()} tokens (${totalPct}%)`);

  return lines.join("\n");
}

/**
 * Format daemon stats for terminal display.
 */
export function formatStats(stats: DaemonStats): string {
  const lines: string[] = [];
  lines.push(`Status: ${stats.status}`);
  lines.push(`Session: ${stats.sessionId ?? "none"}`);
  lines.push(`Messages: ${stats.messageCount}`);
  lines.push(`Uptime: ${formatDuration(stats.uptime)}`);
  return lines.join("\n");
}

/**
 * Format a tool call for terminal display.
 */
export function formatToolCall(name: string, input: Record<string, unknown>): string {
  // Show a compact summary of the tool input
  const summary = compactInput(name, input);
  return `[tool] ${name}${summary ? `: ${summary}` : ""}`;
}

/**
 * Format a tool result for terminal display.
 */
export function formatToolResult(content: string, isError: boolean): string {
  const prefix = isError ? "[tool error]" : "[tool result]";
  // Truncate long results for display
  const maxLen = 200;
  const truncated = content.length > maxLen
    ? content.slice(0, maxLen) + "..."
    : content;
  return `${prefix} ${truncated}`;
}

/**
 * Format an error for terminal display.
 * Distinguishes between user errors and system errors.
 */
export function formatError(error: Error, recoverable: boolean): string {
  if (recoverable) {
    return `[warning] ${error.message} (will retry)`;
  }
  return `[error] ${error.message}`;
}

// ---------------------------------------------------------------------------
// Display Helpers
// ---------------------------------------------------------------------------

function progressBar(current: number, max: number, width: number): string {
  if (max <= 0) return "[" + " ".repeat(width) + "]";
  const ratio = Math.min(current / max, 1);
  const filled = Math.round(ratio * width);
  const empty = width - filled;
  return "[" + "#".repeat(filled) + "-".repeat(empty) + "]";
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function compactInput(toolName: string, input: Record<string, unknown>): string {
  // Tool-specific compact summaries
  switch (toolName) {
    case "bash":
      return typeof input["command"] === "string"
        ? truncate(input["command"] as string, 80)
        : "";
    case "read_file":
      return typeof input["path"] === "string" ? input["path"] as string : "";
    case "write_file":
      return typeof input["path"] === "string" ? input["path"] as string : "";
    case "ssh_exec":
      return `${input["host"] ?? "?"}: ${truncate(String(input["command"] ?? ""), 60)}`;
    case "web_fetch":
      return typeof input["url"] === "string" ? input["url"] as string : "";
    case "cron_manage":
      return typeof input["action"] === "string" ? input["action"] as string : "";
    default:
      return "";
  }
}

function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen) + "...";
}

// ---------------------------------------------------------------------------
// Interactive CLI
// ---------------------------------------------------------------------------

/**
 * Run the interactive CLI loop.
 *
 * This is the main entry point for `jarvis` with no arguments.
 * Reads user input, feeds it to the Daemon, and renders events to stdout.
 */
export async function runCli(config: JarvisConfig, opts: CliOptions = {}): Promise<void> {
  const output = opts.output ?? process.stdout;
  const input = opts.input ?? process.stdin;

  const write = (text: string) => output.write(text);
  const writeln = (text: string) => output.write(text + "\n");

  // Create the daemon
  const daemon = new Daemon(config);
  daemon.start();

  // Show startup banner with tier stats
  writeln("");
  writeln("Jarvis is waking up...");
  try {
    const report = await validateTierBudgets(config);
    writeln(formatStartupBanner(report, config.model));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    writeln(`[warning] Could not read tier stats: ${msg}`);
  }
  writeln("");

  // Create readline interface
  const rl = readline.createInterface({
    input: input as NodeJS.ReadableStream,
    output: output as NodeJS.WritableStream,
    prompt: "You: ",
    terminal: (input as typeof process.stdin).isTTY ?? false,
  });

  // Track whether we're currently processing (for Ctrl+C handling)
  let processing = false;

  // Ctrl+C handling
  rl.on("SIGINT", () => {
    if (processing) {
      // If processing a message, just notify — don't kill the process
      writeln("\n[interrupted]");
      processing = false;
      rl.prompt();
    } else {
      // If idle, shut down gracefully
      writeln("\nShutting down...");
      daemon.endSession("user_quit");
      daemon.shutdown();
      rl.close();
    }
  });

  // Prompt for first input
  rl.prompt();

  // Main input loop
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) {
      rl.prompt();
      continue;
    }

    // Check for slash commands
    const parsed = parseCommand(trimmed);
    if (parsed) {
      const shouldContinue = await handleSlashCommand(parsed.command, daemon, config, writeln);
      if (!shouldContinue) {
        daemon.shutdown();
        rl.close();
        return;
      }
      rl.prompt();
      continue;
    }

    // Regular message — send to daemon
    processing = true;

    for await (const event of daemon.handleMessage(trimmed)) {
      renderEvent(event, write, writeln);
    }

    processing = false;
    writeln(""); // Blank line after response
    rl.prompt();
  }

  // Input stream closed (EOF)
  daemon.endSession("user_quit");
  daemon.shutdown();
}

// ---------------------------------------------------------------------------
// Event Rendering
// ---------------------------------------------------------------------------

/**
 * Render a ConversationEvent to the terminal.
 */
function renderEvent(
  event: ConversationEvent,
  write: (text: string) => void,
  writeln: (text: string) => void,
): void {
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
      // Show token usage on completion
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

// ---------------------------------------------------------------------------
// Slash Command Handler
// ---------------------------------------------------------------------------

/**
 * Handle a slash command. Returns false if the CLI should exit.
 */
async function handleSlashCommand(
  command: SlashCommand,
  daemon: Daemon,
  config: JarvisConfig,
  writeln: (text: string) => void,
): Promise<boolean> {
  switch (command) {
    case "/quit":
      writeln("Session ended. Curators running...");
      daemon.endSession("user_quit");
      return false;

    case "/status":
      writeln(formatStats(daemon.getStats()));
      return true;

    case "/session": {
      const session = daemon.getSessionManager().getActiveSession();
      if (session) {
        const durationMs = daemon.getSessionManager().getSessionDurationMs();
        writeln(`Session: ${session.id}`);
        writeln(`Started: ${session.startTime}`);
        writeln(`Messages: ${session.messageCount}`);
        writeln(`Duration: ${formatDuration(durationMs)}`);
      } else {
        writeln("No active session.");
      }
      return true;
    }

    case "/tiers":
      try {
        const report = await validateTierBudgets(config);
        writeln(formatTierReport(report));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        writeln(`[error] Could not read tier stats: ${msg}`);
      }
      return true;

    case "/help":
      writeln("Commands:");
      writeln("  /quit      End session and exit");
      writeln("  /status    Show daemon status");
      writeln("  /session   Show current session info");
      writeln("  /tiers     Show tier token usage");
      writeln("  /help      Show this help");
      return true;

    default:
      writeln(`Unknown command: ${command}`);
      return true;
  }
}

// ---------------------------------------------------------------------------
// Startup Banner
// ---------------------------------------------------------------------------

function formatStartupBanner(report: TierBudgetReport, model: string): string {
  const t = (tier: number) => {
    const entry = report.tiers.find((t) => t.tier === tier);
    return entry ? `${(entry.tokens / 1000).toFixed(1)}K` : "?";
  };

  return [
    `Jarvis is ready. Model: ${model}`,
    `Context loaded (Tier 1: ${t(1)}, Tier 2: ${t(2)}, Tier 3: ${t(3)}, available: ${((report.tiers[3]?.budget ?? 0) / 1000).toFixed(0)}K)`,
    `Type /help for commands.`,
  ].join("\n");
}
