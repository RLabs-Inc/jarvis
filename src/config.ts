import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TierBudget {
  tier1: number;
  tier2: number;
  tier3: number;
  tier4: number;
}

export interface JarvisConfig {
  /** Claude API auth token (setup-token from Max subscription) */
  authToken: string;

  /** Preferred model for core interactions */
  model: string;

  /** Model for curation (cost-efficient) */
  curationModel: string;

  /** Token budgets per tier */
  tierBudgets: TierBudget;

  /** Path to the mind directory (tier files, conversations, workshop) */
  mindDir: string;

  /** Anthropic API base URL */
  apiBaseUrl: string;

  /** Session idle timeout in milliseconds */
  sessionTimeoutMs: number;

  /** HTTP request timeout in milliseconds (for API calls) */
  requestTimeoutMs: number;

  /** Telegram bot token (optional, Phase 2) */
  telegramToken?: string;

  /** Allowed Telegram chat IDs */
  telegramAllowedChats?: number[];
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const CONFIG_DIR = join(homedir(), ".jarvis");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

export const DEFAULT_CONFIG: JarvisConfig = {
  authToken: "",
  model: "claude-opus-4-6",
  curationModel: "claude-haiku-4-5-20251001",
  tierBudgets: {
    tier1: 20_000,
    tier2: 25_000,
    tier3: 15_000,
    tier4: 140_000,
  },
  mindDir: join(homedir(), "mind"),
  apiBaseUrl: "https://api.anthropic.com",
  sessionTimeoutMs: 30 * 60 * 1000, // 30 minutes
  requestTimeoutMs: 30_000, // 30 seconds
};

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

/**
 * Load config from ~/.jarvis/config.json, merged with defaults.
 * Environment variables override file values:
 *   JARVIS_AUTH_TOKEN        → authToken
 *   JARVIS_MODEL             → model
 *   JARVIS_CURATION_MODEL    → curationModel
 *   JARVIS_MIND_DIR          → mindDir
 *   JARVIS_API_URL           → apiBaseUrl
 *   JARVIS_SESSION_TIMEOUT_MS → sessionTimeoutMs
 *   JARVIS_REQUEST_TIMEOUT_MS → requestTimeoutMs
 *   JARVIS_TELEGRAM_TOKEN     → telegramToken
 *   JARVIS_TELEGRAM_CHATS     → telegramAllowedChats (comma-separated IDs)
 */
export function loadConfig(configPath?: string): JarvisConfig {
  const path = configPath ?? CONFIG_FILE;

  // Start with defaults
  let fileConfig: Partial<JarvisConfig> = {};

  if (existsSync(path)) {
    try {
      const raw = readFileSync(path, "utf-8");
      fileConfig = JSON.parse(raw) as Partial<JarvisConfig>;
    } catch {
      // Malformed JSON — use defaults silently
    }
  }

  // Merge: defaults ← file ← env vars
  const merged: JarvisConfig = {
    ...DEFAULT_CONFIG,
    ...fileConfig,
    tierBudgets: {
      ...DEFAULT_CONFIG.tierBudgets,
      ...(fileConfig.tierBudgets ?? {}),
    },
  };

  // Environment variable overrides (highest priority)
  const env = process.env;

  if (env["JARVIS_AUTH_TOKEN"]) {
    merged.authToken = env["JARVIS_AUTH_TOKEN"];
  }
  if (env["JARVIS_MODEL"]) {
    merged.model = env["JARVIS_MODEL"];
  }
  if (env["JARVIS_CURATION_MODEL"]) {
    merged.curationModel = env["JARVIS_CURATION_MODEL"];
  }
  if (env["JARVIS_MIND_DIR"]) {
    merged.mindDir = env["JARVIS_MIND_DIR"];
  }
  if (env["JARVIS_API_URL"]) {
    merged.apiBaseUrl = env["JARVIS_API_URL"];
  }
  if (env["JARVIS_SESSION_TIMEOUT_MS"]) {
    const parsed = parseInt(env["JARVIS_SESSION_TIMEOUT_MS"], 10);
    if (!isNaN(parsed) && parsed > 0) {
      merged.sessionTimeoutMs = parsed;
    }
  }
  if (env["JARVIS_REQUEST_TIMEOUT_MS"]) {
    const parsed = parseInt(env["JARVIS_REQUEST_TIMEOUT_MS"], 10);
    if (!isNaN(parsed) && parsed > 0) {
      merged.requestTimeoutMs = parsed;
    }
  }

  if (env["JARVIS_TELEGRAM_TOKEN"]) {
    merged.telegramToken = env["JARVIS_TELEGRAM_TOKEN"];
  }
  if (env["JARVIS_TELEGRAM_CHATS"]) {
    const ids = env["JARVIS_TELEGRAM_CHATS"]
      .split(",")
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !isNaN(n));
    if (ids.length > 0) {
      merged.telegramAllowedChats = ids;
    }
  }

  return merged;
}

/**
 * Validate that a config has the minimum required fields to operate.
 * Returns an array of error strings (empty = valid).
 */
export function validateConfig(config: JarvisConfig): string[] {
  const errors: string[] = [];

  if (!config.authToken) {
    errors.push("authToken is required (set JARVIS_AUTH_TOKEN or add to config.json)");
  }

  if (!config.mindDir) {
    errors.push("mindDir is required");
  }

  const { tier1, tier2, tier3, tier4 } = config.tierBudgets;
  if (tier1 <= 0 || tier2 <= 0 || tier3 <= 0 || tier4 <= 0) {
    errors.push("All tier budgets must be positive numbers");
  }

  if (tier1 + tier2 + tier3 + tier4 > 1_000_000) {
    errors.push("Total tier budgets exceed maximum context window (1M tokens)");
  }

  if (config.sessionTimeoutMs <= 0) {
    errors.push("sessionTimeoutMs must be a positive number");
  }

  if (config.requestTimeoutMs <= 0) {
    errors.push("requestTimeoutMs must be a positive number");
  }

  return errors;
}

export { CONFIG_DIR, CONFIG_FILE };
