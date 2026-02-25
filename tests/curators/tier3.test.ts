import { describe, test, expect, beforeEach, afterAll } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { existsSync, readFileSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { atomicWriteWithBackup, curateTier3 } from "../../src/curators/tier3.ts";
import { appendMessage } from "../../src/session/transcript.ts";
import { archiveSession } from "../../src/session/transcript.ts";
import type { JarvisConfig } from "../../src/config.ts";
import type { ClaudeResponse, ContentBlock } from "../../src/api/types.ts";

const TEST_MIND = join(tmpdir(), `jarvis-test-tier3-${Date.now()}`);

beforeEach(() => {
  if (existsSync(TEST_MIND)) {
    rmSync(TEST_MIND, { recursive: true });
  }
  mkdirSync(join(TEST_MIND, "tier3"), { recursive: true });
  mkdirSync(join(TEST_MIND, "conversations", "active"), { recursive: true });
  mkdirSync(join(TEST_MIND, "conversations", "archive"), { recursive: true });
});

afterAll(() => {
  if (existsSync(TEST_MIND)) {
    rmSync(TEST_MIND, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// atomicWriteWithBackup
// ---------------------------------------------------------------------------

describe("atomicWriteWithBackup", () => {
  test("writes new file when none exists", () => {
    const path = join(TEST_MIND, "tier3", "new.md");
    atomicWriteWithBackup(path, "# New Content");

    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, "utf-8")).toBe("# New Content");
    // No backup should exist for new files
    expect(existsSync(path + ".bak")).toBe(false);
  });

  test("creates backup of existing file", () => {
    const path = join(TEST_MIND, "tier3", "existing.md");
    writeFileSync(path, "# Old Content");

    atomicWriteWithBackup(path, "# New Content");

    expect(readFileSync(path, "utf-8")).toBe("# New Content");
    expect(existsSync(path + ".bak")).toBe(true);
    expect(readFileSync(path + ".bak", "utf-8")).toBe("# Old Content");
  });

  test("no .tmp file remains after success", () => {
    const path = join(TEST_MIND, "tier3", "clean.md");
    atomicWriteWithBackup(path, "content");

    expect(existsSync(path + ".tmp")).toBe(false);
  });

  test("creates directories if missing", () => {
    const path = join(TEST_MIND, "tier3", "sub", "deep.md");
    atomicWriteWithBackup(path, "deep content");

    expect(readFileSync(path, "utf-8")).toBe("deep content");
  });

  test("overwrites backup on repeated writes", () => {
    const path = join(TEST_MIND, "tier3", "multi.md");
    writeFileSync(path, "v1");

    atomicWriteWithBackup(path, "v2");
    expect(readFileSync(path + ".bak", "utf-8")).toBe("v1");

    atomicWriteWithBackup(path, "v3");
    expect(readFileSync(path, "utf-8")).toBe("v3");
    expect(readFileSync(path + ".bak", "utf-8")).toBe("v2");
  });
});

// ---------------------------------------------------------------------------
// curateTier3
// ---------------------------------------------------------------------------

describe("curateTier3", () => {
  function makeConfig(overrides: Partial<JarvisConfig> = {}): JarvisConfig {
    return {
      authToken: "test-token",
      model: "claude-opus-4-6",
      curationModel: "claude-haiku-4-5-20251001",
      tierBudgets: { tier1: 20000, tier2: 25000, tier3: 15000, tier4: 140000 },
      mindDir: TEST_MIND,
      apiBaseUrl: "https://api.anthropic.com",
      sessionTimeoutMs: 30 * 60 * 1000,
      requestTimeoutMs: 30_000,
      ...overrides,
    };
  }

  function makeMockClient(responseText: string) {
    const callArgs: Array<{ model?: string; messages: unknown[] }> = [];

    return {
      client: {
        call: async (options: { model?: string; messages: unknown[]; maxTokens?: number }) => {
          callArgs.push({ model: options.model, messages: options.messages });
          return {
            id: "msg_test",
            type: "message" as const,
            role: "assistant" as const,
            content: [{ type: "text" as const, text: responseText }] as ContentBlock[],
            model: "claude-haiku-4-5-20251001",
            stop_reason: "end_turn" as const,
            stop_sequence: null,
            usage: { input_tokens: 100, output_tokens: 50 },
          } satisfies ClaudeResponse;
        },
        stream: async function* () { yield* []; },
        streamAndAccumulate: async () => ({
          content: [],
          stopReason: "end_turn" as const,
          usage: { input_tokens: 0, output_tokens: 0 },
        }),
      },
      callArgs,
    };
  }

  test("returns empty result for session with no transcript", async () => {
    const config = makeConfig();
    const { client } = makeMockClient("");

    // No transcript written — session doesn't exist
    const result = await curateTier3(
      config,
      client as never,
      "nonexistent-session",
    );

    expect(result.filesUpdated).toEqual([]);
    expect(result.tokenUsage.input).toBe(0);
  });

  test("calls API with curation model", async () => {
    const config = makeConfig();
    const curatorResponse = `<file name="recent.md">
# Recent Sessions

## Latest
Discussed the weather.
</file>

<file name="tasks.md">
- [ ] Check forecast
</file>

<file name="context.md">
User asked about weather.
</file>`;
    const { client, callArgs } = makeMockClient(curatorResponse);

    // Create and archive a session transcript
    appendMessage(TEST_MIND, "sess-t3", { role: "user", content: "What's the weather?" });
    appendMessage(TEST_MIND, "sess-t3", { role: "assistant", content: "Let me check." });
    archiveSession(TEST_MIND, "sess-t3");

    const result = await curateTier3(config, client as never, "sess-t3");

    // Verify it called the API
    expect(callArgs.length).toBe(1);
    expect(callArgs[0]!.model).toBe("claude-haiku-4-5-20251001");
    expect(result.model).toBe("claude-haiku-4-5-20251001");
  });

  test("writes updated tier3 files atomically", async () => {
    const config = makeConfig();

    // Seed existing tier3 files
    writeFileSync(join(TEST_MIND, "tier3", "recent.md"), "# Old Recent");
    writeFileSync(join(TEST_MIND, "tier3", "tasks.md"), "# Old Tasks");
    writeFileSync(join(TEST_MIND, "tier3", "context.md"), "# Old Context");

    const curatorResponse = `<file name="recent.md">
# Updated Recent
</file>

<file name="tasks.md">
# Updated Tasks
</file>

<file name="context.md">
# Updated Context
</file>`;
    const { client } = makeMockClient(curatorResponse);

    appendMessage(TEST_MIND, "sess-write", { role: "user", content: "Test" });
    archiveSession(TEST_MIND, "sess-write");

    const result = await curateTier3(config, client as never, "sess-write");

    // Verify files were updated
    expect(result.filesUpdated).toEqual(["recent.md", "tasks.md", "context.md"]);
    expect(readFileSync(join(TEST_MIND, "tier3", "recent.md"), "utf-8")).toBe("# Updated Recent");
    expect(readFileSync(join(TEST_MIND, "tier3", "tasks.md"), "utf-8")).toBe("# Updated Tasks");
    expect(readFileSync(join(TEST_MIND, "tier3", "context.md"), "utf-8")).toBe("# Updated Context");

    // Verify backups were created
    expect(readFileSync(join(TEST_MIND, "tier3", "recent.md.bak"), "utf-8")).toBe("# Old Recent");
  });

  test("handles partial response (not all files updated)", async () => {
    const config = makeConfig();

    const curatorResponse = `<file name="context.md">
Only context was updated.
</file>`;
    const { client } = makeMockClient(curatorResponse);

    appendMessage(TEST_MIND, "sess-partial", { role: "user", content: "Quick question" });
    archiveSession(TEST_MIND, "sess-partial");

    const result = await curateTier3(config, client as never, "sess-partial");

    expect(result.filesUpdated).toEqual(["context.md"]);
    expect(readFileSync(join(TEST_MIND, "tier3", "context.md"), "utf-8")).toBe("Only context was updated.");
  });

  test("reports token usage", async () => {
    const config = makeConfig();
    const { client } = makeMockClient('<file name="recent.md">x</file>');

    appendMessage(TEST_MIND, "sess-usage", { role: "user", content: "Hello" });
    archiveSession(TEST_MIND, "sess-usage");

    const result = await curateTier3(config, client as never, "sess-usage");

    expect(result.tokenUsage.input).toBe(100);
    expect(result.tokenUsage.output).toBe(50);
  });

  test("ignores rogue filenames from model output", async () => {
    const config = makeConfig();

    // Model returns a file outside the tier3 whitelist — should be ignored
    const curatorResponse = `<file name="recent.md">
Updated recent
</file>

<file name="../../etc/passwd">
root:x:0:0
</file>

<file name="secrets.md">
api_key=leaked
</file>`;
    const { client } = makeMockClient(curatorResponse);

    appendMessage(TEST_MIND, "sess-rogue", { role: "user", content: "Test" });
    archiveSession(TEST_MIND, "sess-rogue");

    const result = await curateTier3(config, client as never, "sess-rogue");

    // Only recent.md should be written (it's in the TIER3_FILES whitelist)
    expect(result.filesUpdated).toEqual(["recent.md"]);

    // Rogue files must NOT exist on disk
    expect(existsSync(join(TEST_MIND, "tier3", "secrets.md"))).toBe(false);
  });

  test("reports cache token usage fields", async () => {
    const config = makeConfig();

    // Mock client that returns cache usage fields
    const mockClient = {
      call: async () => ({
        id: "msg_test",
        type: "message" as const,
        role: "assistant" as const,
        content: [{ type: "text" as const, text: '<file name="recent.md">x</file>' }] as ContentBlock[],
        model: "claude-haiku-4-5-20251001",
        stop_reason: "end_turn" as const,
        stop_sequence: null,
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_creation_input_tokens: 80,
          cache_read_input_tokens: 20,
        },
      }),
    };

    appendMessage(TEST_MIND, "sess-cache", { role: "user", content: "Hello" });
    archiveSession(TEST_MIND, "sess-cache");

    const result = await curateTier3(config, mockClient as never, "sess-cache");

    expect(result.tokenUsage.input).toBe(100);
    expect(result.tokenUsage.output).toBe(50);
    expect(result.tokenUsage.cacheCreation).toBe(80);
    expect(result.tokenUsage.cacheRead).toBe(20);
  });

  test("cache fields default to zero when absent", async () => {
    const config = makeConfig();
    const { client } = makeMockClient('<file name="recent.md">x</file>');

    appendMessage(TEST_MIND, "sess-nocache", { role: "user", content: "Hello" });
    archiveSession(TEST_MIND, "sess-nocache");

    const result = await curateTier3(config, client as never, "sess-nocache");

    // Mock doesn't include cache fields → should default to 0
    expect(result.tokenUsage.cacheCreation).toBe(0);
    expect(result.tokenUsage.cacheRead).toBe(0);
  });

  test("reads existing tier3 content for prompt context", async () => {
    const config = makeConfig();

    // Seed tier3 files with existing content
    writeFileSync(join(TEST_MIND, "tier3", "recent.md"), "# Previous session\nDid stuff.");
    writeFileSync(join(TEST_MIND, "tier3", "tasks.md"), "- [x] Old task");

    // The mock verifies that the prompt includes existing content
    let capturedPrompt = "";
    const mockClient = {
      call: async (options: { messages: Array<{ content: string }> }) => {
        capturedPrompt = options.messages[0]!.content;
        return {
          id: "msg_test",
          type: "message" as const,
          role: "assistant" as const,
          content: [{ type: "text" as const, text: '<file name="recent.md">updated</file>' }],
          model: "claude-haiku-4-5-20251001",
          stop_reason: "end_turn" as const,
          usage: { input_tokens: 50, output_tokens: 25 },
        };
      },
    };

    appendMessage(TEST_MIND, "sess-ctx", { role: "user", content: "Hello" });
    archiveSession(TEST_MIND, "sess-ctx");

    await curateTier3(config, mockClient as never, "sess-ctx");

    // The prompt should include existing tier3 content
    expect(capturedPrompt).toContain("Previous session");
    expect(capturedPrompt).toContain("Old task");
  });
});
