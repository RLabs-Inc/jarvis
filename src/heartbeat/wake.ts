// ---------------------------------------------------------------------------
// Wake Handler
// ---------------------------------------------------------------------------
//
// When a cron job fires, it invokes: daemon wake --task <name>
//
// The wake handler:
//   1. Looks up the task definition
//   2. Checks rate limits (defer if throttled)
//   3. Assembles tiered context (Tier 1-3 from files)
//   4. Adds the task's system prompt
//   5. Runs a conversation with the task's user message
//   6. Logs the result to mind/heartbeat/logs/
//
// This is a one-shot execution — it runs, logs, and exits.
// It does NOT use the full Daemon class. It's a lightweight pipeline
// that reuses the same building blocks (assembler, client, conversation).
// ---------------------------------------------------------------------------

import type { JarvisConfig } from "../config.ts";
import type { SystemBlock } from "../api/types.ts";
import { ClaudeClient } from "../api/client.ts";
import { assembleContext } from "../context/assembler.ts";
import { CORE_TOOLS } from "../tools/definitions.ts";
import { runConversation } from "../conversation.ts";
import { getTask } from "./tasks.ts";
import type { TaskDefinition } from "./tasks.ts";
import { checkLimits, shouldThrottle, selectModel, recordUsage } from "./rate-limits.ts";
import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WakeResult {
  task: string;
  success: boolean;
  throttled: boolean;
  model: string;
  response: string;
  durationMs: number;
  error?: string;
  logPath: string;
}

// ---------------------------------------------------------------------------
// Wake Handler
// ---------------------------------------------------------------------------

/**
 * Execute an autonomous task triggered by cron.
 *
 * Pipeline:
 *   task lookup → rate limit check → context assembly → conversation → log
 */
export async function handleWake(
  taskName: string,
  config: JarvisConfig,
): Promise<WakeResult> {
  const startTime = Date.now();
  const logPath = wakeLogPath(config.mindDir, taskName);

  // 1. Look up task
  const task = getTask(taskName);
  if (!task) {
    const result = makeResult(taskName, config.model, logPath, startTime, {
      success: false,
      error: `Unknown task: ${taskName}`,
    });
    writeWakeLog(result);
    return result;
  }

  // 2. Check rate limits
  let model = task.preferredModel ?? config.model;
  try {
    const limits = await checkLimits(config);
    recordUsage(config.mindDir, limits);

    if (shouldThrottle(limits)) {
      const result = makeResult(taskName, model, logPath, startTime, {
        success: true,
        throttled: true,
        response: `Deferred: utilization too high (5h: ${(limits.fiveHour * 100).toFixed(1)}%, 7d: ${(limits.sevenDay * 100).toFixed(1)}%)`,
      });
      writeWakeLog(result);
      return result;
    }

    // Downgrade model if needed
    model = selectModel(limits, model);
  } catch {
    // Rate limit check failed — proceed with preferred model
    // Better to run the task than to skip it because of a usage check error
  }

  // 3. Assemble context + run task
  try {
    const response = await executeTask(task, model, config);
    const result = makeResult(taskName, model, logPath, startTime, {
      success: true,
      response,
    });
    writeWakeLog(result);
    return result;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const result = makeResult(taskName, model, logPath, startTime, {
      success: false,
      error: errorMsg,
    });
    writeWakeLog(result);
    return result;
  }
}

// ---------------------------------------------------------------------------
// Task Execution
// ---------------------------------------------------------------------------

/**
 * Execute a task through the conversation pipeline.
 * Returns the text response from Claude.
 * Throws if the conversation encounters an error.
 */
async function executeTask(
  task: TaskDefinition,
  model: string,
  config: JarvisConfig,
): Promise<string> {
  const client = new ClaudeClient({ ...config, model });

  // Assemble tiered context with the task's user message
  const userMessage = { role: "user" as const, content: task.userMessage };
  const context = await assembleContext(config, [userMessage]);

  // Inject the task's system prompt as an additional system block
  const system: SystemBlock[] = [
    ...context.system,
    { type: "text", text: task.systemPrompt },
  ];

  const tools = task.allowTools ? CORE_TOOLS : [];

  const events = runConversation(client, {
    system,
    tools,
    messages: context.messages,
    // No artificial turn limit — let the task run to completion
    // (non-tool tasks still complete in 1 turn naturally)
  });

  // Collect text, but throw on errors (unlike collectText which swallows them)
  let text = "";
  for await (const event of events) {
    if (event.type === "text_delta") {
      text += event.text;
    } else if (event.type === "error") {
      throw event.error;
    }
  }
  return text;
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function wakeLogDir(mindDir: string): string {
  return join(mindDir, "heartbeat", "logs");
}

function wakeLogPath(mindDir: string, taskName: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return join(wakeLogDir(mindDir), `${taskName}_${timestamp}.json`);
}

function writeWakeLog(result: WakeResult): void {
  // Ensure directory structure exists by using the parent dir of the log path
  const logDir = result.logPath.substring(0, result.logPath.lastIndexOf("/"));
  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true });
  }

  writeFileSync(result.logPath, JSON.stringify(result, null, 2));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResult(
  task: string,
  model: string,
  logPath: string,
  startTime: number,
  overrides: {
    success: boolean;
    throttled?: boolean;
    response?: string;
    error?: string;
  },
): WakeResult {
  return {
    task,
    success: overrides.success,
    throttled: overrides.throttled ?? false,
    model,
    response: overrides.response ?? "",
    durationMs: Date.now() - startTime,
    error: overrides.error,
    logPath,
  };
}
