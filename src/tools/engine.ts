// ---------------------------------------------------------------------------
// Tool Execution Engine
// ---------------------------------------------------------------------------
//
// Routes tool_use blocks from the API to the correct implementation.
// Returns formatted tool_result blocks ready for the next API call.
//
// Each tool handler catches its own errors and formats them as error results.
// The engine never throws — it always returns a ToolResult.
// ---------------------------------------------------------------------------

import type { ToolUseBlock, ToolResultBlock } from "../api/types.ts";
import { TOOL_NAMES } from "./definitions.ts";
import { execBash, execInteractive, stripAnsi, truncateOutput } from "./bash.ts";
import { readFile, writeFile } from "./files.ts";
import { sshExec } from "./ssh.ts";
import { cronList, cronAdd, cronRemove } from "./cron.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ToolResult {
  content: string;
  is_error: boolean;
}

// ---------------------------------------------------------------------------
// Max output for tool results sent back to the API
// ---------------------------------------------------------------------------

const MAX_TOOL_OUTPUT = 50_000; // ~12.5K tokens

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

/**
 * Execute a tool call and return a formatted result.
 * Never throws — errors become ToolResult with is_error: true.
 */
export async function executeTool(toolUse: ToolUseBlock): Promise<ToolResult> {
  try {
    switch (toolUse.name) {
      case TOOL_NAMES.bash:
        return await handleBash(toolUse.input);
      case TOOL_NAMES.read_file:
        return await handleReadFile(toolUse.input);
      case TOOL_NAMES.write_file:
        return await handleWriteFile(toolUse.input);
      case TOOL_NAMES.ssh_exec:
        return await handleSshExec(toolUse.input);
      case TOOL_NAMES.cron_manage:
        return await handleCronManage(toolUse.input);
      case TOOL_NAMES.web_fetch:
        return await handleWebFetch(toolUse.input);
      default:
        return { content: `Unknown tool: ${toolUse.name}`, is_error: true };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { content: `Tool execution error: ${message}`, is_error: true };
  }
}

/**
 * Execute a tool call and format it as a ToolResultBlock for the API.
 */
export async function executeToolForApi(toolUse: ToolUseBlock): Promise<ToolResultBlock> {
  const result = await executeTool(toolUse);
  // API rejects empty content when is_error is true
  const content = result.content || (result.is_error ? "Tool failed with no output" : "(no output)");
  return {
    type: "tool_result",
    tool_use_id: toolUse.id,
    content,
    is_error: result.is_error || undefined,
  };
}

// ---------------------------------------------------------------------------
// Tool Handlers
// ---------------------------------------------------------------------------

async function handleBash(input: Record<string, unknown>): Promise<ToolResult> {
  const command = input["command"] as string;
  if (!command) return { content: "Missing required field: command", is_error: true };

  const interactive = input["interactive"] as boolean | undefined;
  const opts = {
    timeout_ms: input["timeout_ms"] as number | undefined,
    working_dir: input["working_dir"] as string | undefined,
    stdin_text: input["stdin_text"] as string | undefined,
  };

  const result = interactive
    ? await execInteractive(command, opts)
    : await execBash(command, opts);

  // Clean up PTY output if interactive
  const stdout = interactive ? stripAnsi(result.stdout) : result.stdout;

  let output = stdout;
  if (result.stderr) {
    output += `\n[stderr]\n${result.stderr}`;
  }
  if (result.timedOut) {
    output += `\n[timed out after ${opts.timeout_ms ?? 30000}ms]`;
  }

  const isError = result.exitCode !== 0;
  const finalOutput = truncateOutput(output, MAX_TOOL_OUTPUT);

  return {
    content: finalOutput || (isError ? `Command failed with exit code ${result.exitCode}` : "(no output)"),
    is_error: isError,
  };
}

async function handleReadFile(input: Record<string, unknown>): Promise<ToolResult> {
  const path = input["path"] as string;
  if (!path) return { content: "Missing required field: path", is_error: true };

  const offset = input["offset"] as number | undefined;
  const limit = input["limit"] as number | undefined;
  const content = await readFile(path, offset, limit);

  return { content: truncateOutput(content, MAX_TOOL_OUTPUT), is_error: false };
}

async function handleWriteFile(input: Record<string, unknown>): Promise<ToolResult> {
  const path = input["path"] as string;
  const content = input["content"] as string;
  if (!path || content === undefined) {
    return { content: "Missing required fields: path, content", is_error: true };
  }

  await writeFile(path, content);
  return { content: `Written to ${path}`, is_error: false };
}

async function handleSshExec(input: Record<string, unknown>): Promise<ToolResult> {
  const host = input["host"] as string;
  const command = input["command"] as string;
  if (!host || !command) {
    return { content: "Missing required fields: host, command", is_error: true };
  }

  const timeout_ms = input["timeout_ms"] as number | undefined;
  const result = await sshExec(host, command, timeout_ms);

  let output = result.output;
  if (result.timedOut) {
    output += `\n[timed out after ${timeout_ms ?? 30000}ms]`;
  }

  const isError = result.exitCode !== 0;
  const finalOutput = truncateOutput(output, MAX_TOOL_OUTPUT);

  return {
    content: finalOutput || (isError ? `SSH command failed with exit code ${result.exitCode}` : "(no output)"),
    is_error: isError,
  };
}

async function handleCronManage(input: Record<string, unknown>): Promise<ToolResult> {
  const action = input["action"] as string;
  if (!action) return { content: "Missing required field: action", is_error: true };

  switch (action) {
    case "list": {
      const entries = await cronList();
      if (entries.length === 0) return { content: "No Jarvis cron entries.", is_error: false };
      const lines = entries.map((e) => `[${e.id}] ${e.schedule} ${e.command}`);
      return { content: lines.join("\n"), is_error: false };
    }
    case "add": {
      const schedule = input["schedule"] as string;
      const command = input["command"] as string;
      const id = input["id"] as string;
      if (!schedule || !command || !id) {
        return { content: "Missing required fields for add: schedule, command, id", is_error: true };
      }
      await cronAdd({ id, schedule, command });
      return { content: `Cron entry '${id}' added: ${schedule} ${command}`, is_error: false };
    }
    case "remove": {
      const id = input["id"] as string;
      if (!id) return { content: "Missing required field for remove: id", is_error: true };
      await cronRemove(id);
      return { content: `Cron entry '${id}' removed.`, is_error: false };
    }
    default:
      return { content: `Unknown cron action: ${action}`, is_error: true };
  }
}

const DEFAULT_FETCH_TIMEOUT_MS = 30_000;

async function handleWebFetch(input: Record<string, unknown>): Promise<ToolResult> {
  const url = input["url"] as string;
  if (!url) return { content: "Missing required field: url", is_error: true };

  const method = (input["method"] as string) ?? "GET";
  const headers = input["headers"] as Record<string, string> | undefined;
  const body = input["body"] as string | undefined;
  const timeout = (input["timeout_ms"] as number | undefined) ?? DEFAULT_FETCH_TIMEOUT_MS;

  // AbortController prevents hanging on slow/unresponsive URLs
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      method,
      headers: headers ?? {},
      body: method === "POST" ? body : undefined,
      signal: controller.signal,
    });

    const text = await response.text();
    const status = `[${response.status} ${response.statusText}]\n`;

    return {
      content: truncateOutput(status + text, MAX_TOOL_OUTPUT),
      is_error: !response.ok,
    };
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return { content: `Request timed out after ${timeout}ms`, is_error: true };
    }
    throw err; // Re-throw non-timeout errors for the outer catch in executeTool
  } finally {
    clearTimeout(timer);
  }
}
