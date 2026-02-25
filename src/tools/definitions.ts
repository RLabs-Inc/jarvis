// ---------------------------------------------------------------------------
// Core Tool Definitions
// ---------------------------------------------------------------------------
//
// Tool definitions matching the Claude API tool schema.
// These are sent with every API call so Claude knows what tools are available.
//
// No spawn_agent tool — Claude Code IS the agent system.
// When Jarvis needs agents/teams, it opens a Claude Code session via PTY bash.
// ---------------------------------------------------------------------------

import type { ToolDefinition } from "../api/types.ts";

// ---------------------------------------------------------------------------
// Tool Names (single source of truth)
// ---------------------------------------------------------------------------

export const TOOL_NAMES = {
  bash: "bash",
  read_file: "read_file",
  write_file: "write_file",
  ssh_exec: "ssh_exec",
  cron_manage: "cron_manage",
  web_fetch: "web_fetch",
} as const;

export type ToolName = (typeof TOOL_NAMES)[keyof typeof TOOL_NAMES];

// ---------------------------------------------------------------------------
// Definitions
// ---------------------------------------------------------------------------

export const CORE_TOOLS: ToolDefinition[] = [
  {
    name: TOOL_NAMES.bash,
    description:
      "Execute a shell command in the vessel's bash shell. This is the primary tool for running " +
      "any CLI program, build command, package manager, or system utility. Use interactive: true " +
      "when the command needs a real pseudo-terminal (PTY) — for example Claude Code sessions, " +
      "ssh interactive sessions, TUI programs like vim or htop, or any program that expects a TTY. " +
      "Non-interactive mode (the default) is faster and cleaner for simple commands like ls, cat, " +
      "git, curl, etc. Output is automatically truncated if it exceeds 100K characters. Commands " +
      "that exceed the timeout are killed and marked as timed out with exit code 124.",
    input_schema: {
      type: "object",
      properties: {
        command: { type: "string", description: "The shell command to execute" },
        timeout_ms: {
          type: "number",
          description: "Timeout in milliseconds (default: 30000). The command is killed if it exceeds this.",
        },
        working_dir: {
          type: "string",
          description: "Working directory for the command. Defaults to the vessel's current directory.",
        },
        interactive: {
          type: "boolean",
          description:
            "If true, allocates a PTY via the system script command. Required for Claude Code, " +
            "ssh, vim, and any program that expects a terminal. Output will contain ANSI sequences " +
            "which are automatically stripped when returning results.",
        },
        stdin_text: {
          type: "string",
          description: "Text to write to the command's stdin before it runs. Useful for piping input " +
            "or answering interactive prompts. Stdin is closed after writing.",
        },
      },
      required: ["command"],
    },
  },
  {
    name: TOOL_NAMES.read_file,
    description:
      "Read a file from the vessel's filesystem. Returns the full file content as text (UTF-8). " +
      "For large files, use offset and limit to read a specific range of lines instead of the " +
      "entire file, which prevents output truncation and reduces token usage. The tool throws " +
      "an error if the file does not exist or is not readable.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute path to the file to read" },
        offset: {
          type: "number",
          description: "Line number to start reading from (0-indexed). Omit to start from the beginning.",
        },
        limit: {
          type: "number",
          description: "Maximum number of lines to read. Omit to read through the end of file.",
        },
      },
      required: ["path"],
    },
  },
  {
    name: TOOL_NAMES.write_file,
    description:
      "Write content to a file on the vessel's filesystem. Creates all parent directories " +
      "automatically if they don't exist. Overwrites the file completely if it already exists. " +
      "Use this for creating new files, updating configuration, saving scripts, or any " +
      "file creation task. Content is written as UTF-8 text.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute path to the file to write" },
        content: { type: "string", description: "The full content to write to the file" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: TOOL_NAMES.ssh_exec,
    description:
      "Execute a command on a remote machine via SSH using key-based authentication. Requires " +
      "SSH keys to be pre-configured — the tool uses BatchMode=yes so it will never hang on a " +
      "password prompt (it fails immediately instead). StrictHostKeyChecking=accept-new means " +
      "first-time connections are accepted but changed host keys are rejected for security. " +
      "Use this for accessing Tailscale-networked machines (Mac Mini, laptop, servers). Both " +
      "stdout and stderr from the remote command are captured and returned together.",
    input_schema: {
      type: "object",
      properties: {
        host: {
          type: "string",
          description: "SSH host — either a hostname (e.g., 'mac-mini') or user@hostname (e.g., 'rusty@mac-mini')",
        },
        command: { type: "string", description: "The command to execute on the remote machine" },
        timeout_ms: {
          type: "number",
          description: "Timeout in milliseconds (default: 30000). Applies to both connection and execution.",
        },
      },
      required: ["host", "command"],
    },
  },
  {
    name: TOOL_NAMES.cron_manage,
    description:
      "Manage Jarvis's own crontab entries for autonomous scheduling. Each entry is tagged with " +
      "a unique ID (via '# jarvis:<id>' comment) for safe identification and removal. System " +
      "cron entries are never modified — only Jarvis-tagged entries are managed. Use 'list' to " +
      "see current entries, 'add' to create or replace an entry (same ID replaces existing), " +
      "and 'remove' to delete an entry by ID.",
    input_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["list", "add", "remove"],
          description: "The cron management action to perform",
        },
        schedule: {
          type: "string",
          description: "Cron schedule expression in standard format: 'min hour dom month dow' (required for 'add')",
        },
        command: {
          type: "string",
          description: "The shell command to schedule (required for 'add')",
        },
        id: {
          type: "string",
          description: "Unique entry identifier used for tagging (required for 'add' and 'remove')",
        },
      },
      required: ["action"],
    },
  },
  {
    name: TOOL_NAMES.web_fetch,
    description:
      "Fetch content from a URL using HTTP. Supports GET and POST methods with optional custom " +
      "headers and request body. Returns the HTTP status code and response body as text. The " +
      "response is marked as an error if the HTTP status indicates failure (4xx/5xx). Requests " +
      "time out after 30 seconds by default. Use this for API calls, downloading web content, " +
      "checking service health, or any HTTP interaction.",
    input_schema: {
      type: "object",
      properties: {
        url: { type: "string", description: "The full URL to fetch (must include https:// or http://)" },
        method: {
          type: "string",
          enum: ["GET", "POST"],
          description: "HTTP method to use (default: GET)",
        },
        headers: {
          type: "object",
          description: "Custom request headers as key-value pairs (e.g., {\"Authorization\": \"Bearer token\"})",
        },
        body: { type: "string", description: "Request body content (only used with POST method)" },
        timeout_ms: {
          type: "number",
          description: "Request timeout in milliseconds (default: 30000)",
        },
      },
      required: ["url"],
    },
  },
];
