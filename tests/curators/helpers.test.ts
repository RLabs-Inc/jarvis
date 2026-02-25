import { describe, test, expect, beforeEach, afterAll } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { existsSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { readTierFile, extractText } from "../../src/curators/helpers.ts";
import type { ContentBlock } from "../../src/api/types.ts";

const TEST_MIND = join(tmpdir(), `jarvis-test-helpers-${Date.now()}`);

beforeEach(() => {
  if (existsSync(TEST_MIND)) {
    rmSync(TEST_MIND, { recursive: true });
  }
  mkdirSync(join(TEST_MIND, "tier2"), { recursive: true });
  mkdirSync(join(TEST_MIND, "tier3"), { recursive: true });
});

afterAll(() => {
  if (existsSync(TEST_MIND)) {
    rmSync(TEST_MIND, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// readTierFile
// ---------------------------------------------------------------------------

describe("readTierFile", () => {
  test("reads existing tier file", () => {
    writeFileSync(join(TEST_MIND, "tier2", "projects.md"), "# Active Projects");
    expect(readTierFile(TEST_MIND, 2, "projects.md")).toBe("# Active Projects");
  });

  test("returns empty string for missing file", () => {
    expect(readTierFile(TEST_MIND, 3, "nonexistent.md")).toBe("");
  });

  test("returns empty string for missing tier directory", () => {
    expect(readTierFile(TEST_MIND, 1, "identity.md")).toBe("");
  });

  test("reads from correct tier directory", () => {
    writeFileSync(join(TEST_MIND, "tier2", "skills.md"), "tier2-content");
    writeFileSync(join(TEST_MIND, "tier3", "skills.md"), "tier3-content");
    expect(readTierFile(TEST_MIND, 2, "skills.md")).toBe("tier2-content");
    expect(readTierFile(TEST_MIND, 3, "skills.md")).toBe("tier3-content");
  });
});

// ---------------------------------------------------------------------------
// extractText
// ---------------------------------------------------------------------------

describe("extractText", () => {
  test("extracts text from text blocks", () => {
    const blocks: ContentBlock[] = [
      { type: "text", text: "Hello " },
      { type: "text", text: "world" },
    ];
    expect(extractText(blocks)).toBe("Hello world");
  });

  test("ignores tool_use blocks", () => {
    const blocks: ContentBlock[] = [
      { type: "text", text: "Before " },
      { type: "tool_use", id: "tu_1", name: "bash", input: { command: "ls" } },
      { type: "text", text: "after" },
    ];
    expect(extractText(blocks)).toBe("Before after");
  });

  test("ignores tool_result blocks", () => {
    const blocks: ContentBlock[] = [
      { type: "tool_result", tool_use_id: "tu_1", content: "result output" },
      { type: "text", text: "Summary" },
    ];
    expect(extractText(blocks)).toBe("Summary");
  });

  test("returns empty string for empty array", () => {
    expect(extractText([])).toBe("");
  });

  test("returns empty string when no text blocks present", () => {
    const blocks: ContentBlock[] = [
      { type: "tool_use", id: "tu_1", name: "bash", input: {} },
    ];
    expect(extractText(blocks)).toBe("");
  });
});
