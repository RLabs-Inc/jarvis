// ---------------------------------------------------------------------------
// SSH Remote Execution
// ---------------------------------------------------------------------------
//
// Execute commands on remote machines via the native ssh binary.
// No npm dependencies — just the ssh command that's already on the vessel.
// Relies on SSH keys being configured (no password prompts).
// ---------------------------------------------------------------------------

import { execBash } from "./bash.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SshResult {
  output: string;
  exitCode: number;
  timedOut: boolean;
}

// ---------------------------------------------------------------------------
// SSH Execution
// ---------------------------------------------------------------------------

const DEFAULT_SSH_TIMEOUT_MS = 30_000;

/**
 * Shell-quote a string using POSIX single-quote escaping.
 * Wraps in single quotes and escapes any embedded single quotes.
 * Prevents shell metacharacter injection when building command strings.
 */
export function shellQuote(arg: string): string {
  return "'" + arg.replace(/'/g, "'\\''") + "'";
}

/**
 * Execute a command on a remote host via SSH.
 *
 * Uses BatchMode=yes to fail immediately if key auth doesn't work
 * (never hangs on password prompt). StrictHostKeyChecking=accept-new
 * auto-accepts first-time connections but rejects changed keys.
 *
 * Both host and command are shell-quoted to prevent injection through
 * specially-crafted parameter values.
 */
export async function sshExec(
  host: string,
  command: string,
  timeout_ms?: number,
): Promise<SshResult> {
  const timeout = timeout_ms ?? DEFAULT_SSH_TIMEOUT_MS;

  // Build the ssh command with safety options.
  // Shell-quote host and command to prevent injection via bash -c.
  const sshCmd = [
    "ssh",
    "-o", "BatchMode=yes",
    "-o", "StrictHostKeyChecking=accept-new",
    "-o", `ConnectTimeout=${Math.ceil(timeout / 1000)}`,
    shellQuote(host),
    shellQuote(command),
  ].join(" ");

  const result = await execBash(sshCmd, { timeout_ms: timeout });

  return {
    output: result.stdout + (result.stderr ? `\n${result.stderr}` : ""),
    exitCode: result.exitCode,
    timedOut: result.timedOut,
  };
}
