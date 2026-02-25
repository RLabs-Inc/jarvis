#!/usr/bin/env bun
// ---------------------------------------------------------------------------
// CLI Entry Point
// ---------------------------------------------------------------------------
//
// The single entry point for all Jarvis CLI usage:
//
//   jarvis              Start interactive session
//   jarvis wake <task>  Execute a cron-triggered task
//   jarvis status       Show vessel status (tier stats, session info)
//   jarvis tiers        Show tier token usage
//   jarvis tasks        List available autonomous tasks
//
// Minimal arg parsing — no dependency needed for this.
// ---------------------------------------------------------------------------

import { loadConfig, validateConfig } from "./config.ts";
import type { JarvisConfig } from "./config.ts";
import { runCli, formatTierReport } from "./senses/cli.ts";
import { validateTierBudgets } from "./context/tiers.ts";
import { Daemon } from "./daemon.ts";
import { listTasks, getTask } from "./heartbeat/tasks.ts";
import { createTelegramBot } from "./senses/telegram.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CliCommand = "interactive" | "wake" | "telegram" | "status" | "tiers" | "tasks" | "help";

export interface ParsedArgs {
  command: CliCommand;
  taskName?: string;
}

// ---------------------------------------------------------------------------
// Argument Parsing
// ---------------------------------------------------------------------------

/**
 * Parse process arguments into a command and options.
 * Args are expected after the script name (Bun strips the runtime).
 */
export function parseArgs(args: string[]): ParsedArgs {
  if (args.length === 0) {
    return { command: "interactive" };
  }

  const command = args[0]!.toLowerCase();

  switch (command) {
    case "wake": {
      // jarvis wake --task morning_routine  OR  jarvis wake morning_routine
      const taskIdx = args.indexOf("--task");
      const taskName = taskIdx !== -1 && args[taskIdx + 1]
        ? args[taskIdx + 1]
        : args[1];
      return { command: "wake", taskName };
    }

    case "telegram":
      return { command: "telegram" };

    case "status":
      return { command: "status" };

    case "tiers":
      return { command: "tiers" };

    case "tasks":
      return { command: "tasks" };

    case "help":
    case "--help":
    case "-h":
      return { command: "help" };

    default:
      return { command: "help" };
  }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function commandInteractive(config: JarvisConfig): Promise<void> {
  await runCli(config);
}

async function commandWake(config: JarvisConfig, taskName: string | undefined): Promise<void> {
  if (!taskName) {
    console.error("[error] Missing task name. Usage: jarvis wake --task <name>");
    console.error("Available tasks:", listTasks().join(", "));
    process.exit(1);
  }

  const task = getTask(taskName);
  if (!task) {
    console.error(`[error] Unknown task: ${taskName}`);
    console.error("Available tasks:", listTasks().join(", "));
    process.exit(1);
  }

  console.log(`[wake] Running task: ${taskName} (${task.description})`);

  const daemon = new Daemon(config);
  try {
    const result = await daemon.wake(taskName);
    if (result.throttled) {
      console.log(`[wake] Deferred: rate limits too high`);
    } else if (result.success) {
      console.log(`[wake] Complete (${result.durationMs}ms, model: ${result.model})`);
      if (result.response) {
        console.log(result.response);
      }
    } else {
      console.error(`[wake] Failed: ${result.error}`);
      process.exit(1);
    }
    console.log(`[wake] Log: ${result.logPath}`);
  } finally {
    daemon.shutdown();
  }
}

async function commandStatus(config: JarvisConfig): Promise<void> {
  console.log("Jarvis Vessel Status");
  console.log("====================");
  console.log(`Model: ${config.model}`);
  console.log(`Mind: ${config.mindDir}`);
  console.log(`Session timeout: ${(config.sessionTimeoutMs / 1000 / 60).toFixed(0)} minutes`);
  console.log("");

  try {
    const report = await validateTierBudgets(config);
    console.log(formatTierReport(report));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[error] Could not read tier stats: ${msg}`);
  }
}

async function commandTiers(config: JarvisConfig): Promise<void> {
  try {
    const report = await validateTierBudgets(config);
    console.log(formatTierReport(report));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[error] Could not read tier stats: ${msg}`);
  }
}

async function commandTelegram(config: JarvisConfig): Promise<void> {
  if (!config.telegramToken) {
    console.error("[error] Telegram token not configured.");
    console.error("Set JARVIS_TELEGRAM_TOKEN or add telegramToken to config.json");
    process.exit(1);
  }

  const daemon = new Daemon(config);
  daemon.start();

  const bot = createTelegramBot(daemon, config);
  if (!bot) {
    console.error("[error] Failed to create Telegram bot.");
    daemon.shutdown();
    process.exit(1);
  }

  console.log("[telegram] Starting Telegram bot...");
  bot.start();

  // Keep running until SIGINT/SIGTERM
  const shutdown = () => {
    console.log("\n[telegram] Shutting down...");
    bot.stop();
    daemon.endSession("shutdown");
    daemon.shutdown();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Keep the process alive
  await new Promise(() => {});
}

function commandTasks(): void {
  const tasks = listTasks();
  console.log("Available autonomous tasks:");
  for (const name of tasks) {
    const task = getTask(name);
    console.log(`  ${name} — ${task?.description ?? ""}`);
  }
}

function commandHelp(): void {
  console.log("Jarvis — A persistent AI vessel");
  console.log("");
  console.log("Usage:");
  console.log("  jarvis              Start interactive session");
  console.log("  jarvis telegram     Start Telegram bot (long polling)");
  console.log("  jarvis wake <task>  Execute a cron-triggered task");
  console.log("  jarvis status       Show vessel status");
  console.log("  jarvis tiers        Show tier token usage");
  console.log("  jarvis tasks        List available autonomous tasks");
  console.log("  jarvis help         Show this help");
  console.log("");
  console.log("Interactive commands:");
  console.log("  /quit      End session and exit");
  console.log("  /status    Show daemon status");
  console.log("  /session   Show current session info");
  console.log("  /tiers     Show tier token usage");
  console.log("  /help      Show available commands");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function main(args: string[]): Promise<void> {
  const parsed = parseArgs(args);

  // Help doesn't need config
  if (parsed.command === "help") {
    commandHelp();
    return;
  }

  // Tasks doesn't need config validation
  if (parsed.command === "tasks") {
    commandTasks();
    return;
  }

  // Load and validate config
  const config = loadConfig();
  const errors = validateConfig(config);

  // For non-interactive commands, auth is required
  if (errors.length > 0 && parsed.command !== "status" && parsed.command !== "tiers") {
    console.error("[error] Configuration errors:");
    for (const err of errors) {
      console.error(`  - ${err}`);
    }
    process.exit(1);
  }

  switch (parsed.command) {
    case "interactive":
      await commandInteractive(config);
      break;
    case "wake":
      await commandWake(config, parsed.taskName);
      break;
    case "telegram":
      await commandTelegram(config);
      break;
    case "status":
      await commandStatus(config);
      break;
    case "tiers":
      await commandTiers(config);
      break;
  }
}

// Run when executed directly
const isMainModule = typeof Bun !== "undefined" && Bun.main === import.meta.path;
if (isMainModule) {
  main(process.argv.slice(2)).catch((err) => {
    console.error("[fatal]", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
