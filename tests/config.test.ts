import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { loadConfig, validateConfig, DEFAULT_CONFIG } from "../src/config.ts";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TEST_DIR = join(tmpdir(), `jarvis-test-config-${Date.now()}`);
const TEST_CONFIG_PATH = join(TEST_DIR, "config.json");

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true });
  }
  // Clean env vars
  delete process.env["JARVIS_AUTH_TOKEN"];
  delete process.env["JARVIS_MODEL"];
  delete process.env["JARVIS_CURATION_MODEL"];
  delete process.env["JARVIS_MIND_DIR"];
  delete process.env["JARVIS_API_URL"];
  delete process.env["JARVIS_SESSION_TIMEOUT_MS"];
  delete process.env["JARVIS_REQUEST_TIMEOUT_MS"];
});

describe("loadConfig", () => {
  test("returns defaults when no config file exists", () => {
    const config = loadConfig(join(TEST_DIR, "nonexistent.json"));
    expect(config.model).toBe(DEFAULT_CONFIG.model);
    expect(config.tierBudgets.tier1).toBe(20_000);
    expect(config.tierBudgets.tier2).toBe(25_000);
    expect(config.tierBudgets.tier3).toBe(15_000);
    expect(config.tierBudgets.tier4).toBe(140_000);
    expect(config.sessionTimeoutMs).toBe(30 * 60 * 1000);
  });

  test("loads config from file and merges with defaults", () => {
    writeFileSync(
      TEST_CONFIG_PATH,
      JSON.stringify({ authToken: "sk-test-123", model: "claude-sonnet-4-6" }),
    );
    const config = loadConfig(TEST_CONFIG_PATH);
    expect(config.authToken).toBe("sk-test-123");
    expect(config.model).toBe("claude-sonnet-4-6");
    // Defaults preserved for unspecified fields
    expect(config.tierBudgets.tier1).toBe(20_000);
  });

  test("merges tier budgets partially", () => {
    writeFileSync(
      TEST_CONFIG_PATH,
      JSON.stringify({ tierBudgets: { tier1: 30_000 } }),
    );
    const config = loadConfig(TEST_CONFIG_PATH);
    expect(config.tierBudgets.tier1).toBe(30_000);
    expect(config.tierBudgets.tier2).toBe(25_000); // default preserved
  });

  test("env vars override file values", () => {
    writeFileSync(
      TEST_CONFIG_PATH,
      JSON.stringify({ authToken: "from-file", model: "from-file" }),
    );
    process.env["JARVIS_AUTH_TOKEN"] = "from-env";
    process.env["JARVIS_MODEL"] = "claude-haiku-4-5-20251001";

    const config = loadConfig(TEST_CONFIG_PATH);
    expect(config.authToken).toBe("from-env");
    expect(config.model).toBe("claude-haiku-4-5-20251001");
  });

  test("env vars override defaults when no file", () => {
    process.env["JARVIS_MIND_DIR"] = "/custom/mind";
    process.env["JARVIS_API_URL"] = "https://custom.api.com";

    const config = loadConfig(join(TEST_DIR, "nonexistent.json"));
    expect(config.mindDir).toBe("/custom/mind");
    expect(config.apiBaseUrl).toBe("https://custom.api.com");
  });

  test("JARVIS_SESSION_TIMEOUT_MS overrides timeout", () => {
    process.env["JARVIS_SESSION_TIMEOUT_MS"] = "60000";
    const config = loadConfig(join(TEST_DIR, "nonexistent.json"));
    expect(config.sessionTimeoutMs).toBe(60000);
  });

  test("ignores invalid JARVIS_SESSION_TIMEOUT_MS", () => {
    process.env["JARVIS_SESSION_TIMEOUT_MS"] = "not-a-number";
    const config = loadConfig(join(TEST_DIR, "nonexistent.json"));
    expect(config.sessionTimeoutMs).toBe(DEFAULT_CONFIG.sessionTimeoutMs);
  });

  test("JARVIS_REQUEST_TIMEOUT_MS overrides requestTimeoutMs", () => {
    process.env["JARVIS_REQUEST_TIMEOUT_MS"] = "5000";
    const config = loadConfig(join(TEST_DIR, "nonexistent.json"));
    expect(config.requestTimeoutMs).toBe(5000);
  });

  test("ignores invalid JARVIS_REQUEST_TIMEOUT_MS", () => {
    process.env["JARVIS_REQUEST_TIMEOUT_MS"] = "abc";
    const config = loadConfig(join(TEST_DIR, "nonexistent.json"));
    expect(config.requestTimeoutMs).toBe(DEFAULT_CONFIG.requestTimeoutMs);
  });

  test("defaults requestTimeoutMs to 30000", () => {
    const config = loadConfig(join(TEST_DIR, "nonexistent.json"));
    expect(config.requestTimeoutMs).toBe(30_000);
  });

  test("JARVIS_CURATION_MODEL overrides curationModel", () => {
    process.env["JARVIS_CURATION_MODEL"] = "claude-sonnet-4-6";
    const config = loadConfig(join(TEST_DIR, "nonexistent.json"));
    expect(config.curationModel).toBe("claude-sonnet-4-6");
  });

  test("JARVIS_CURATION_MODEL overrides file value", () => {
    writeFileSync(
      TEST_CONFIG_PATH,
      JSON.stringify({ curationModel: "from-file" }),
    );
    process.env["JARVIS_CURATION_MODEL"] = "from-env";
    const config = loadConfig(TEST_CONFIG_PATH);
    expect(config.curationModel).toBe("from-env");
  });

  test("handles malformed JSON gracefully", () => {
    writeFileSync(TEST_CONFIG_PATH, "{ bad json }}}");
    const config = loadConfig(TEST_CONFIG_PATH);
    // Should fall back to defaults without throwing
    expect(config.model).toBe(DEFAULT_CONFIG.model);
  });
});

describe("validateConfig", () => {
  test("valid config produces no errors", () => {
    const config = { ...DEFAULT_CONFIG, authToken: "sk-test" };
    const errors = validateConfig(config);
    expect(errors).toHaveLength(0);
  });

  test("missing authToken produces error", () => {
    const errors = validateConfig(DEFAULT_CONFIG);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain("authToken");
  });

  test("zero tier budget produces error", () => {
    const config = {
      ...DEFAULT_CONFIG,
      authToken: "sk-test",
      tierBudgets: { ...DEFAULT_CONFIG.tierBudgets, tier1: 0 },
    };
    const errors = validateConfig(config);
    expect(errors.some((e) => e.includes("positive"))).toBe(true);
  });

  test("excessive total budget produces error", () => {
    const config = {
      ...DEFAULT_CONFIG,
      authToken: "sk-test",
      tierBudgets: { tier1: 500_000, tier2: 500_000, tier3: 500_000, tier4: 500_000 },
    };
    const errors = validateConfig(config);
    expect(errors.some((e) => e.includes("exceed"))).toBe(true);
  });

  test("negative sessionTimeoutMs produces error", () => {
    const config = {
      ...DEFAULT_CONFIG,
      authToken: "sk-test",
      sessionTimeoutMs: -1000,
    };
    const errors = validateConfig(config);
    expect(errors.some((e) => e.includes("sessionTimeoutMs"))).toBe(true);
  });

  test("zero sessionTimeoutMs produces error", () => {
    const config = {
      ...DEFAULT_CONFIG,
      authToken: "sk-test",
      sessionTimeoutMs: 0,
    };
    const errors = validateConfig(config);
    expect(errors.some((e) => e.includes("sessionTimeoutMs"))).toBe(true);
  });

  test("negative requestTimeoutMs produces error", () => {
    const config = {
      ...DEFAULT_CONFIG,
      authToken: "sk-test",
      requestTimeoutMs: -1,
    };
    const errors = validateConfig(config);
    expect(errors.some((e) => e.includes("requestTimeoutMs"))).toBe(true);
  });

  test("zero requestTimeoutMs produces error", () => {
    const config = {
      ...DEFAULT_CONFIG,
      authToken: "sk-test",
      requestTimeoutMs: 0,
    };
    const errors = validateConfig(config);
    expect(errors.some((e) => e.includes("requestTimeoutMs"))).toBe(true);
  });
});
