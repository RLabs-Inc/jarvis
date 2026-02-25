import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  assembleContext,
  buildSystemBlocks,
  truncateMessages,
} from "../../src/context/assembler.ts";
import { BudgetExceededError } from "../../src/context/tokens.ts";
import { DEFAULT_CONFIG, type JarvisConfig } from "../../src/config.ts";
import type { Message } from "../../src/api/types.ts";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TEST_MIND = join(tmpdir(), `jarvis-test-assembler-${Date.now()}`);

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
// Full context assembly — all 4 tiers
// ---------------------------------------------------------------------------

describe("assembleContext — full assembly", () => {
  test("assembles all 4 tiers into system blocks + messages", async () => {
    setupTier(1, { "identity.md": "I am Jarvis" });
    setupTier(2, { "projects.md": "Building the vessel" });
    setupTier(3, { "recent.md": "Session C in progress" });

    const messages: Message[] = [
      { role: "user", content: "Hello Watson" },
      { role: "assistant", content: "Hello Sherlock" },
    ];

    const result = await assembleContext(testConfig(), messages);

    // 3 system blocks (one per tier)
    expect(result.system).toHaveLength(3);
    expect(result.system[0]!.text).toBe("I am Jarvis");
    expect(result.system[1]!.text).toBe("Building the vessel");
    expect(result.system[2]!.text).toBe("Session C in progress");

    // Messages passed through
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0]!.content).toBe("Hello Watson");

    // No budget warnings when everything fits (small test data triggers
    // below_cache_minimum which is informational, not a budget problem)
    expect(result.warnings.filter((w) => w.type === "over_budget")).toHaveLength(0);
    expect(result.warnings.filter((w) => w.type === "tier4_truncated")).toHaveLength(0);
    expect(result.budget.allWithinBudget).toBe(true);
  });

  test("handles empty tiers gracefully (no empty system blocks)", async () => {
    setupTier(1, { "identity.md": "I am Jarvis" });
    // No tier2 or tier3 directories/files

    const messages: Message[] = [{ role: "user", content: "Hi" }];
    const result = await assembleContext(testConfig(), messages);

    expect(result.system).toHaveLength(1); // Only tier 1
    expect(result.system[0]!.text).toBe("I am Jarvis");
    expect(result.messages).toHaveLength(1);
  });

  test("handles empty messages array", async () => {
    setupTier(1, { "identity.md": "Jarvis" });
    const result = await assembleContext(testConfig(), []);

    expect(result.system).toHaveLength(1);
    expect(result.messages).toHaveLength(0);
    expect(result.budget.tiers[3]!.tokens).toBe(0);
  });

  test("budget report includes accurate token counts for all tiers", async () => {
    setupTier(1, { "id.md": "A".repeat(40) });  // 10 tokens
    setupTier(2, { "proj.md": "B".repeat(80) }); // 20 tokens
    setupTier(3, { "rec.md": "C".repeat(120) }); // 30 tokens

    const messages: Message[] = [
      { role: "user", content: "D".repeat(160) }, // 40 tokens
    ];

    const result = await assembleContext(testConfig(), messages);

    expect(result.budget.tiers[0]!.tokens).toBe(10);
    expect(result.budget.tiers[1]!.tokens).toBe(20);
    expect(result.budget.tiers[2]!.tokens).toBe(30);
    expect(result.budget.tiers[3]!.tokens).toBe(40);
    expect(result.budget.totalTokens).toBe(100);
  });

  test("multi-file tiers are concatenated before assembly", async () => {
    setupTier(1, {
      "a_identity.md": "# Identity",
      "b_values.md": "# Values",
    });

    const result = await assembleContext(testConfig(), []);
    expect(result.system[0]!.text).toBe("# Identity\n\n# Values");
  });

  test("messages with content block arrays are handled correctly", async () => {
    setupTier(1, { "id.md": "Jarvis" });
    const messages: Message[] = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "Let me check that for you." },
          { type: "tool_use", id: "tu_1", name: "bash", input: { command: "ls" } },
        ],
      },
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "tu_1", content: "file1.txt\nfile2.txt" },
        ],
      },
    ];

    const result = await assembleContext(testConfig(), messages);
    expect(result.messages).toHaveLength(2);
    expect(result.budget.tiers[3]!.tokens).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Cache breakpoint placement
// ---------------------------------------------------------------------------

describe("buildSystemBlocks — cache breakpoints", () => {
  test("tier 1 gets 1h TTL cache breakpoint", () => {
    const blocks = buildSystemBlocks("identity", "", "");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
  });

  test("tier 2 gets 1h TTL cache breakpoint", () => {
    const blocks = buildSystemBlocks("", "projects", "");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
  });

  test("tier 3 gets 5m TTL cache breakpoint", () => {
    const blocks = buildSystemBlocks("", "", "recent");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.cache_control).toEqual({ type: "ephemeral", ttl: "5m" });
  });

  test("all three tiers produce three blocks in order with correct TTLs", () => {
    const blocks = buildSystemBlocks("identity", "projects", "recent");
    expect(blocks).toHaveLength(3);

    expect(blocks[0]!.text).toBe("identity");
    expect(blocks[0]!.cache_control).toEqual({ type: "ephemeral", ttl: "1h" });

    expect(blocks[1]!.text).toBe("projects");
    expect(blocks[1]!.cache_control).toEqual({ type: "ephemeral", ttl: "1h" });

    expect(blocks[2]!.text).toBe("recent");
    expect(blocks[2]!.cache_control).toEqual({ type: "ephemeral", ttl: "5m" });
  });

  test("empty tiers are omitted — no empty text blocks", () => {
    const blocks = buildSystemBlocks("identity", "", "recent");
    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.text).toBe("identity");
    expect(blocks[1]!.text).toBe("recent");
  });
});

// ---------------------------------------------------------------------------
// Overflow handling per tier
// ---------------------------------------------------------------------------

describe("overflow handling", () => {
  test("tier 1 over budget throws BudgetExceededError", async () => {
    // Budget = 5 tokens = 20 chars. Write 100 chars = 25 tokens.
    setupTier(1, { "big.md": "X".repeat(100) });

    const config = testConfig({
      tierBudgets: { tier1: 5, tier2: 25_000, tier3: 15_000, tier4: 140_000 },
    });

    await expect(assembleContext(config, [])).rejects.toThrow(BudgetExceededError);
  });

  test("tier 2 over budget produces warning but succeeds", async () => {
    setupTier(1, { "id.md": "ok" });
    setupTier(2, { "big.md": "X".repeat(200) }); // 50 tokens

    const config = testConfig({
      tierBudgets: { tier1: 20_000, tier2: 10, tier3: 15_000, tier4: 140_000 },
    });

    const result = await assembleContext(config, []);
    const budgetWarnings = result.warnings.filter((w) => w.type === "over_budget");
    expect(budgetWarnings).toHaveLength(1);
    expect(budgetWarnings[0]!.tier).toBe(2);
    expect(budgetWarnings[0]!.message).toContain("Curators should compress");

    // Content still included in system blocks
    expect(result.system.find((s) => s.text.includes("X".repeat(10)))).toBeTruthy();
  });

  test("tier 3 over budget produces warning but succeeds", async () => {
    setupTier(1, { "id.md": "ok" });
    setupTier(3, { "big.md": "Y".repeat(200) }); // 50 tokens

    const config = testConfig({
      tierBudgets: { tier1: 20_000, tier2: 25_000, tier3: 10, tier4: 140_000 },
    });

    const result = await assembleContext(config, []);
    const budgetWarnings = result.warnings.filter((w) => w.type === "over_budget");
    expect(budgetWarnings).toHaveLength(1);
    expect(budgetWarnings[0]!.tier).toBe(3);
    expect(budgetWarnings[0]!.message).toContain("drop oldest");
  });

  test("tier 4 over budget truncates oldest messages", async () => {
    setupTier(1, { "id.md": "ok" });

    // Create messages that total well over budget
    const messages: Message[] = [
      { role: "user", content: "A".repeat(400) },     // 100 tokens
      { role: "assistant", content: "B".repeat(400) }, // 100 tokens
      { role: "user", content: "C".repeat(400) },     // 100 tokens (latest)
    ];

    // Tier 4 budget = 150 tokens — can fit 1.5 messages, so keeps last 2
    const config = testConfig({
      tierBudgets: { tier1: 20_000, tier2: 25_000, tier3: 15_000, tier4: 150 },
    });

    const result = await assembleContext(config, messages);
    // Should have dropped the oldest message(s) to fit budget
    expect(result.messages.length).toBeLessThan(3);
    // The latest message should always be kept
    expect(result.messages[result.messages.length - 1]!.content).toBe("C".repeat(400));
    // Warning emitted
    expect(result.warnings.some((w) => w.type === "tier4_truncated")).toBe(true);
  });

  test("tier 4 always keeps at least the last message even if over budget", async () => {
    setupTier(1, { "id.md": "ok" });

    const messages: Message[] = [
      { role: "user", content: "Z".repeat(1000) }, // 250 tokens — way over budget
    ];

    const config = testConfig({
      tierBudgets: { tier1: 20_000, tier2: 25_000, tier3: 15_000, tier4: 10 },
    });

    const result = await assembleContext(config, messages);
    // Must keep the message even though it exceeds budget
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]!.content).toBe("Z".repeat(1000));
  });
});

// ---------------------------------------------------------------------------
// below_cache_minimum warning
// ---------------------------------------------------------------------------

describe("below_cache_minimum warning", () => {
  test("warns when total system tokens are below model minimum", async () => {
    // Write small tier content: 10 chars = ~3 tokens per tier, total ~9
    setupTier(1, { "id.md": "tiny" });
    setupTier(2, { "proj.md": "tiny" });
    setupTier(3, { "rec.md": "tiny" });

    const config = testConfig(); // model = "claude-opus-4-6", min = 4096
    const result = await assembleContext(config, []);

    const cacheWarning = result.warnings.find(
      (w) => w.type === "below_cache_minimum",
    );
    expect(cacheWarning).toBeDefined();
    expect(cacheWarning!.message).toContain("below the minimum cacheable threshold");
    expect(cacheWarning!.message).toContain("4096");
  });

  test("no warning when system tokens meet minimum", async () => {
    // 20K chars = 5000 tokens, above 4096 minimum
    setupTier(1, { "id.md": "X".repeat(20_000) });

    const config = testConfig();
    const result = await assembleContext(config, []);

    const cacheWarning = result.warnings.find(
      (w) => w.type === "below_cache_minimum",
    );
    expect(cacheWarning).toBeUndefined();
  });

  test("no warning when all tiers are empty", async () => {
    // Empty tiers = 0 tokens. No warning because there's nothing to cache.
    const config = testConfig();
    const result = await assembleContext(config, []);

    const cacheWarning = result.warnings.find(
      (w) => w.type === "below_cache_minimum",
    );
    expect(cacheWarning).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// truncateMessages (unit)
// ---------------------------------------------------------------------------

describe("truncateMessages", () => {
  test("returns all messages when within budget", () => {
    const msgs: Message[] = [
      { role: "user", content: "short" },
      { role: "assistant", content: "reply" },
    ];
    const { truncated, tier4Tokens } = truncateMessages(msgs, 100_000);
    expect(truncated).toHaveLength(2);
    expect(tier4Tokens).toBeGreaterThan(0);
  });

  test("drops oldest messages first", () => {
    const msgs: Message[] = [
      { role: "user", content: "A".repeat(400) },     // 100 tokens
      { role: "assistant", content: "B".repeat(400) }, // 100 tokens
      { role: "user", content: "C".repeat(40) },      // 10 tokens
    ];
    // Budget = 50 tokens — only the last message fits
    const { truncated } = truncateMessages(msgs, 50);
    expect(truncated).toHaveLength(1);
    expect(truncated[0]!.content).toBe("C".repeat(40));
  });

  test("returns empty array for empty input", () => {
    const { truncated, tier4Tokens } = truncateMessages([], 1000);
    expect(truncated).toHaveLength(0);
    expect(tier4Tokens).toBe(0);
  });

  test("keeps at least one message", () => {
    const msgs: Message[] = [
      { role: "user", content: "X".repeat(2000) }, // 500 tokens
    ];
    const { truncated } = truncateMessages(msgs, 10);
    expect(truncated).toHaveLength(1);
  });
});
