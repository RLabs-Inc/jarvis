import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { readTier, writeTier, tierTokenCount, validateTierBudgets } from "../../src/context/tiers.ts";
import { countTokens } from "../../src/context/tokens.ts";
import { DEFAULT_CONFIG, type JarvisConfig } from "../../src/config.ts";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TEST_MIND = join(tmpdir(), `jarvis-test-tiers-${Date.now()}`);

function setupTier(tierNum: 1 | 2 | 3, files: Record<string, string>): void {
  const dir = join(TEST_MIND, `tier${tierNum}`);
  mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content, "utf-8");
  }
}

function testConfig(overrides?: Partial<JarvisConfig>): JarvisConfig {
  return {
    ...DEFAULT_CONFIG,
    authToken: "sk-test",
    mindDir: TEST_MIND,
    ...overrides,
  };
}

beforeEach(() => {
  mkdirSync(TEST_MIND, { recursive: true });
});

afterEach(() => {
  if (existsSync(TEST_MIND)) {
    rmSync(TEST_MIND, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// readTier — single file
// ---------------------------------------------------------------------------

describe("readTier — single file", () => {
  test("reads a single markdown file from a tier directory", async () => {
    setupTier(1, { "identity.md": "# I am Jarvis" });
    const result = await readTier(TEST_MIND, 1);

    expect(result.tier).toBe(1);
    expect(result.text).toBe("# I am Jarvis");
    expect(result.tokens).toBe(countTokens("# I am Jarvis"));
    expect(result.files).toEqual(["identity.md"]);
  });

  test("returns empty for nonexistent tier directory", async () => {
    const result = await readTier(TEST_MIND, 2);
    expect(result.text).toBe("");
    expect(result.tokens).toBe(0);
    expect(result.files).toEqual([]);
  });

  test("returns empty for tier directory with no .md files", async () => {
    const dir = join(TEST_MIND, "tier3");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "notes.txt"), "not markdown");
    const result = await readTier(TEST_MIND, 3);
    expect(result.text).toBe("");
    expect(result.files).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// readTier — multi-file concatenation
// ---------------------------------------------------------------------------

describe("readTier — multi-file", () => {
  test("concatenates multiple files with double newline separator", async () => {
    setupTier(1, {
      "a_identity.md": "# Identity",
      "b_preferences.md": "# Preferences",
    });
    const result = await readTier(TEST_MIND, 1);
    expect(result.text).toBe("# Identity\n\n# Preferences");
    expect(result.files).toEqual(["a_identity.md", "b_preferences.md"]);
  });

  test("sorts files alphabetically for deterministic ordering", async () => {
    setupTier(2, {
      "z_last.md": "last",
      "a_first.md": "first",
      "m_middle.md": "middle",
    });
    const result = await readTier(TEST_MIND, 2);
    expect(result.text).toBe("first\n\nmiddle\n\nlast");
    expect(result.files).toEqual(["a_first.md", "m_middle.md", "z_last.md"]);
  });

  test("ignores non-markdown files in tier directory", async () => {
    const dir = join(TEST_MIND, "tier1");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "identity.md"), "# Jarvis");
    writeFileSync(join(dir, ".DS_Store"), "junk");
    writeFileSync(join(dir, "backup.bak"), "backup");

    const result = await readTier(TEST_MIND, 1);
    expect(result.files).toEqual(["identity.md"]);
    expect(result.text).toBe("# Jarvis");
  });

  test("token count reflects concatenated content", async () => {
    setupTier(3, {
      "recent.md": "A".repeat(100),
      "tasks.md": "B".repeat(200),
    });
    const result = await readTier(TEST_MIND, 3);
    // 100 + 2 (separator \n\n) + 200 = 302 chars → ceil(302/4) = 76
    expect(result.tokens).toBe(countTokens("A".repeat(100) + "\n\n" + "B".repeat(200)));
  });
});

// ---------------------------------------------------------------------------
// writeTier
// ---------------------------------------------------------------------------

describe("writeTier", () => {
  test("writes a file to tier 2", async () => {
    await writeTier(TEST_MIND, 2, "projects.md", "# Projects\n\nJarvis");
    const result = await readTier(TEST_MIND, 2);
    expect(result.text).toBe("# Projects\n\nJarvis");
    expect(result.files).toEqual(["projects.md"]);
  });

  test("writes a file to tier 3", async () => {
    await writeTier(TEST_MIND, 3, "recent.md", "Session summary");
    const result = await readTier(TEST_MIND, 3);
    expect(result.text).toBe("Session summary");
  });

  test("creates tier directory if it does not exist", async () => {
    // Don't pre-create the tier2 directory
    await writeTier(TEST_MIND, 2, "skills.md", "# Skills");
    const result = await readTier(TEST_MIND, 2);
    expect(result.text).toBe("# Skills");
  });

  test("overwrites existing file content", async () => {
    await writeTier(TEST_MIND, 3, "tasks.md", "old content");
    await writeTier(TEST_MIND, 3, "tasks.md", "new content");
    const result = await readTier(TEST_MIND, 3);
    expect(result.text).toBe("new content");
  });
});

// ---------------------------------------------------------------------------
// tierTokenCount
// ---------------------------------------------------------------------------

describe("tierTokenCount", () => {
  test("returns token count for a tier", async () => {
    setupTier(1, { "identity.md": "A".repeat(400) });
    const tokens = await tierTokenCount(TEST_MIND, 1);
    expect(tokens).toBe(100); // 400 chars / 4
  });

  test("returns 0 for empty tier", async () => {
    const tokens = await tierTokenCount(TEST_MIND, 2);
    expect(tokens).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// validateTierBudgets
// ---------------------------------------------------------------------------

describe("validateTierBudgets", () => {
  test("all tiers within budget reports ok", async () => {
    setupTier(1, { "id.md": "short" });
    setupTier(2, { "proj.md": "short" });
    setupTier(3, { "recent.md": "short" });

    const report = await validateTierBudgets(testConfig());
    expect(report.allWithinBudget).toBe(true);
    expect(report.tiers).toHaveLength(4);
    expect(report.tiers[0]!.status).toBe("ok");
    expect(report.tiers[1]!.status).toBe("ok");
    expect(report.tiers[2]!.status).toBe("ok");
    expect(report.tiers[3]!.status).toBe("ok"); // Tier 4 always ok (no files)
  });

  test("over-budget tier is flagged", async () => {
    // Tier 1 budget = 10 tokens = 40 chars. Write 200 chars = 50 tokens.
    setupTier(1, { "big.md": "X".repeat(200) });
    setupTier(2, { "ok.md": "small" });
    setupTier(3, { "ok.md": "small" });

    const config = testConfig({
      tierBudgets: { tier1: 10, tier2: 25_000, tier3: 15_000, tier4: 140_000 },
    });
    const report = await validateTierBudgets(config);

    expect(report.allWithinBudget).toBe(false);
    expect(report.tiers[0]!.status).toBe("over_budget");
    expect(report.tiers[0]!.overage).toBe(40); // 50 tokens - 10 budget
  });

  test("tier 4 reports zero tokens (filled at assembly time)", async () => {
    setupTier(1, { "id.md": "x" });
    const report = await validateTierBudgets(testConfig());
    const tier4 = report.tiers.find((t) => t.tier === 4);
    expect(tier4!.tokens).toBe(0);
    expect(tier4!.budget).toBe(140_000);
  });

  test("totalTokens sums tiers 1-3 only", async () => {
    setupTier(1, { "a.md": "A".repeat(40) }); // 10 tokens
    setupTier(2, { "b.md": "B".repeat(80) }); // 20 tokens
    setupTier(3, { "c.md": "C".repeat(120) }); // 30 tokens

    const report = await validateTierBudgets(testConfig());
    expect(report.totalTokens).toBe(60); // 10 + 20 + 30 + 0 (tier4)
  });

  test("totalBudget sums all four tier budgets", async () => {
    const report = await validateTierBudgets(testConfig());
    expect(report.totalBudget).toBe(200_000); // 20K + 25K + 15K + 140K
  });
});
