// ---------------------------------------------------------------------------
// Setup-Token Authentication
// ---------------------------------------------------------------------------
//
// Jarvis authenticates using a setup-token from the Max subscription.
// Token format: sk-ant-oat01-...
// Auth method: Bearer token in Authorization header
//
// The token is loaded from config (which checks env vars and config.json).
// Usage can be queried to track subscription utilization.
// ---------------------------------------------------------------------------

import type { JarvisConfig } from "../config.ts";
import type { UsageInfo } from "./types.ts";
import { ClaudeApiError } from "./types.ts";

/** HTTP headers required for Claude API calls. */
export function buildAuthHeaders(config: JarvisConfig): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "anthropic-version": "2023-06-01",
  };

  // OAuth tokens (sk-ant-oat-*) require Bearer auth + beta headers.
  // Without oauth-2025-04-20 beta, API returns 401
  // "OAuth authentication is currently not supported".
  if (isOAuthToken(config.authToken)) {
    headers["Authorization"] = `Bearer ${config.authToken}`;
    headers["anthropic-beta"] = "oauth-2025-04-20,claude-code-20250219";
  } else {
    headers["X-Api-Key"] = config.authToken;
  }

  return headers;
}

/** Check if a token is an OAuth token (setup-token from Max subscription). */
export function isOAuthToken(token: string): boolean {
  return token.startsWith("sk-ant-oat");
}

/**
 * Check Max subscription usage.
 * Returns utilization info for rate limit awareness.
 */
export async function checkUsage(config: JarvisConfig): Promise<UsageInfo> {
  const url = `${config.apiBaseUrl}/api/oauth/usage`;

  const response = await fetch(url, {
    headers: {
      "Authorization": `Bearer ${config.authToken}`,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "oauth-2025-04-20",
    },
  });

  if (!response.ok) {
    throw new ClaudeApiError(
      response.status,
      "usage_error",
      `Failed to check usage: ${response.status} ${response.statusText}`,
    );
  }

  return (await response.json()) as UsageInfo;
}

/** Validate that a token looks like a setup-token. */
export function isValidTokenFormat(token: string): boolean {
  return token.startsWith("sk-ant-oat01-") && token.length > 20;
}
