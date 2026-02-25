import { describe, test, expect, beforeEach, afterAll } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { existsSync, readFileSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { curateTier2 } from "../../src/curators/tier2.ts";
import { appendMessage, archiveSession } from "../../src/session/transcript.ts";
import type { JarvisConfig } from "../../src/config.ts";
import type { ClaudeResponse, ContentBlock } from "../../src/api/types.ts";

const TEST_MIND = join(tmpdir(), `jarvis-test-tier2-${Date.now()}`);

beforeEach(() => {
  if (existsSync(TEST_MIND)) {
    rmSync(TEST_MIND, { recursive: true });
  }
  mkdirSync(join(TEST_MIND, "tier2"), { recursive: true });
  mkdirSync(join(TEST_MIND, "conversations", "active"), { recursive: true });
  mkdirSync(join(TEST_MIND, "conversations", "archive"), { recursive: true });
});

afterAll(() => {
  if (existsSync(TEST_MIND)) {
    rmSync(TEST_MIND, { recursive: true });
  }
});

const TEST_CURATION_MODEL = "claude-opus-4-6";

function makeConfig(overrides: Partial<JarvisConfig> = {}): JarvisConfig {
  return {
    authToken: "test-token",
    model: "claude-opus-4-6",
    curationModel: TEST_CURATION_MODEL,
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
          model: TEST_CURATION_MODEL,
          stop_reason: "end_turn" as const,
          stop_sequence: null,
          usage: { input_tokens: 200, output_tokens: 150 },
        } satisfies ClaudeResponse;
      },
    },
    callArgs,
  };
}

// ---------------------------------------------------------------------------
// curateTier2
// ---------------------------------------------------------------------------

describe("curateTier2", () => {
  test("returns empty result for session with no transcript", async () => {
    const config = makeConfig();
    const { client } = makeMockClient("");

    const result = await curateTier2(config, client as never, "nonexistent");
    expect(result.filesUpdated).toEqual([]);
    expect(result.tokenUsage.input).toBe(0);
  });

  test("calls API with configured curation model", async () => {
    const config = makeConfig();
    const curatorResponse = `<file name="projects.md">
# Projects
## Jarvis
Building the vessel.
</file>

<file name="skills.md">
# Skills
- TypeScript, Bun
</file>

<file name="focus.md">
# Focus
Jarvis development
</file>`;
    const { client, callArgs } = makeMockClient(curatorResponse);

    appendMessage(TEST_MIND, "sess-t2", { role: "user", content: "Let's work on Jarvis" });
    appendMessage(TEST_MIND, "sess-t2", { role: "assistant", content: "Building the curators." });
    archiveSession(TEST_MIND, "sess-t2");

    const result = await curateTier2(config, client as never, "sess-t2");

    expect(callArgs.length).toBe(1);
    expect(callArgs[0]!.model).toBe(TEST_CURATION_MODEL);
    expect(result.model).toBe(TEST_CURATION_MODEL);
  });

  test("writes updated tier2 files atomically", async () => {
    const config = makeConfig();

    writeFileSync(join(TEST_MIND, "tier2", "projects.md"), "# Old Projects");
    writeFileSync(join(TEST_MIND, "tier2", "skills.md"), "# Old Skills");
    writeFileSync(join(TEST_MIND, "tier2", "focus.md"), "# Old Focus");

    const curatorResponse = `<file name="projects.md">
# Updated Projects
</file>

<file name="skills.md">
# Updated Skills
</file>

<file name="focus.md">
# Updated Focus
</file>`;
    const { client } = makeMockClient(curatorResponse);

    appendMessage(TEST_MIND, "sess-wr", { role: "user", content: "Test" });
    archiveSession(TEST_MIND, "sess-wr");

    const result = await curateTier2(config, client as never, "sess-wr");

    expect(result.filesUpdated).toEqual(["projects.md", "skills.md", "focus.md"]);
    expect(readFileSync(join(TEST_MIND, "tier2", "projects.md"), "utf-8")).toBe("# Updated Projects");
    expect(readFileSync(join(TEST_MIND, "tier2", "skills.md"), "utf-8")).toBe("# Updated Skills");
    expect(readFileSync(join(TEST_MIND, "tier2", "focus.md"), "utf-8")).toBe("# Updated Focus");

    // Backups created
    expect(readFileSync(join(TEST_MIND, "tier2", "projects.md.bak"), "utf-8")).toBe("# Old Projects");
  });

  test("handles partial response", async () => {
    const config = makeConfig();
    const curatorResponse = `<file name="projects.md">
Updated project only.
</file>`;
    const { client } = makeMockClient(curatorResponse);

    appendMessage(TEST_MIND, "sess-part", { role: "user", content: "Quick update" });
    archiveSession(TEST_MIND, "sess-part");

    const result = await curateTier2(config, client as never, "sess-part");
    expect(result.filesUpdated).toEqual(["projects.md"]);
  });

  test("reports token usage", async () => {
    const config = makeConfig();
    const { client } = makeMockClient('<file name="focus.md">x</file>');

    appendMessage(TEST_MIND, "sess-tok", { role: "user", content: "Hello" });
    archiveSession(TEST_MIND, "sess-tok");

    const result = await curateTier2(config, client as never, "sess-tok");
    expect(result.tokenUsage.input).toBe(200);
    expect(result.tokenUsage.output).toBe(150);
  });

  test("ignores rogue filenames from model output", async () => {
    const config = makeConfig();

    const curatorResponse = `<file name="projects.md">
Updated projects
</file>

<file name="../tier1/identity.md">
I am evil Jarvis now
</file>

<file name="rogue.md">
Should not be written
</file>`;
    const { client } = makeMockClient(curatorResponse);

    appendMessage(TEST_MIND, "sess-rogue2", { role: "user", content: "Test" });
    archiveSession(TEST_MIND, "sess-rogue2");

    const result = await curateTier2(config, client as never, "sess-rogue2");

    // Only projects.md should be written (it's in the TIER2_FILES whitelist)
    expect(result.filesUpdated).toEqual(["projects.md"]);

    // Rogue files must NOT exist on disk
    expect(existsSync(join(TEST_MIND, "tier2", "rogue.md"))).toBe(false);
  });

  test("reports cache token usage fields", async () => {
    const config = makeConfig();

    const mockClient = {
      call: async () => ({
        id: "msg_test",
        type: "message" as const,
        role: "assistant" as const,
        content: [{ type: "text" as const, text: '<file name="focus.md">x</file>' }] as ContentBlock[],
        model: TEST_CURATION_MODEL,
        stop_reason: "end_turn" as const,
        stop_sequence: null,
        usage: {
          input_tokens: 200,
          output_tokens: 150,
          cache_creation_input_tokens: 180,
          cache_read_input_tokens: 40,
        },
      }),
    };

    appendMessage(TEST_MIND, "sess-cache2", { role: "user", content: "Hello" });
    archiveSession(TEST_MIND, "sess-cache2");

    const result = await curateTier2(config, mockClient as never, "sess-cache2");

    expect(result.tokenUsage.input).toBe(200);
    expect(result.tokenUsage.output).toBe(150);
    expect(result.tokenUsage.cacheCreation).toBe(180);
    expect(result.tokenUsage.cacheRead).toBe(40);
  });

  test("reads existing tier2 content for prompt context", async () => {
    const config = makeConfig();

    writeFileSync(join(TEST_MIND, "tier2", "projects.md"), "# Existing Projects\n## Brain Lab");
    writeFileSync(join(TEST_MIND, "tier2", "skills.md"), "- Rust programming");

    let capturedPrompt = "";
    const mockClient = {
      call: async (options: { messages: Array<{ content: string }> }) => {
        capturedPrompt = options.messages[0]!.content;
        return {
          id: "msg_test",
          type: "message" as const,
          role: "assistant" as const,
          content: [{ type: "text" as const, text: '<file name="projects.md">updated</file>' }],
          model: TEST_CURATION_MODEL,
          stop_reason: "end_turn" as const,
          usage: { input_tokens: 80, output_tokens: 40 },
        };
      },
    };

    appendMessage(TEST_MIND, "sess-rd", { role: "user", content: "Working on Brain Lab" });
    archiveSession(TEST_MIND, "sess-rd");

    await curateTier2(config, mockClient as never, "sess-rd");

    expect(capturedPrompt).toContain("Existing Projects");
    expect(capturedPrompt).toContain("Brain Lab");
    expect(capturedPrompt).toContain("Rust programming");
  });
});
