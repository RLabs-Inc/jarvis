import { describe, test, expect } from "bun:test";
import {
  formatTranscript,
  buildTier3Prompt,
  buildTier2Prompt,
  parseCuratorResponse,
} from "../../src/curators/prompts.ts";
import type { Message } from "../../src/api/types.ts";

// ---------------------------------------------------------------------------
// formatTranscript
// ---------------------------------------------------------------------------

describe("formatTranscript", () => {
  test("formats simple string messages", () => {
    const messages: Message[] = [
      { role: "user", content: "Hello Jarvis" },
      { role: "assistant", content: "Hello Sherlock" },
    ];
    const result = formatTranscript(messages);
    expect(result).toContain("User: Hello Jarvis");
    expect(result).toContain("Assistant: Hello Sherlock");
  });

  test("formats ContentBlock messages with text", () => {
    const messages: Message[] = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "Let me check that." },
        ],
      },
    ];
    const result = formatTranscript(messages);
    expect(result).toContain("Assistant: Let me check that.");
  });

  test("formats tool_use blocks as summaries", () => {
    const messages: Message[] = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "Running a command." },
          { type: "tool_use", id: "tu_1", name: "bash", input: { command: "ls" } },
        ],
      },
    ];
    const result = formatTranscript(messages);
    expect(result).toContain("[Tool: bash(");
    expect(result).toContain('"command":"ls"');
  });

  test("formats tool_result blocks with truncation", () => {
    const longOutput = "x".repeat(600);
    const messages: Message[] = [
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "tu_1", content: longOutput },
        ],
      },
    ];
    const result = formatTranscript(messages);
    expect(result).toContain("[Tool Result (OK):");
    expect(result).toContain("...[truncated]");
  });

  test("marks error tool results", () => {
    const messages: Message[] = [
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "tu_1", content: "command not found", is_error: true },
        ],
      },
    ];
    const result = formatTranscript(messages);
    expect(result).toContain("[Tool Result (ERROR):");
  });

  test("returns empty string for empty messages", () => {
    expect(formatTranscript([])).toBe("");
  });

  test("skips ContentBlock messages with no extractable content", () => {
    const messages: Message[] = [
      { role: "assistant", content: [] },
    ];
    const result = formatTranscript(messages);
    expect(result).toBe("");
  });
});

// ---------------------------------------------------------------------------
// parseCuratorResponse
// ---------------------------------------------------------------------------

describe("parseCuratorResponse", () => {
  test("parses single file", () => {
    const response = `<file name="recent.md">
# Recent Sessions

## Session 1
Did some work.
</file>`;
    const files = parseCuratorResponse(response);
    expect(files.size).toBe(1);
    expect(files.get("recent.md")).toContain("# Recent Sessions");
    expect(files.get("recent.md")).toContain("Did some work.");
  });

  test("parses multiple files", () => {
    const response = `<file name="recent.md">
Recent content
</file>

<file name="tasks.md">
Task content
</file>

<file name="context.md">
Context content
</file>`;
    const files = parseCuratorResponse(response);
    expect(files.size).toBe(3);
    expect(files.get("recent.md")).toBe("Recent content");
    expect(files.get("tasks.md")).toBe("Task content");
    expect(files.get("context.md")).toBe("Context content");
  });

  test("returns empty map for no file tags", () => {
    const files = parseCuratorResponse("Just some text without any file tags.");
    expect(files.size).toBe(0);
  });

  test("trims whitespace from file content", () => {
    const response = `<file name="test.md">

  some content with spaces

</file>`;
    const files = parseCuratorResponse(response);
    expect(files.get("test.md")).toBe("some content with spaces");
  });

  test("handles file content with special characters", () => {
    const response = `<file name="code.md">
\`\`\`typescript
const x = 1;
// <not a tag>
\`\`\`
</file>`;
    const files = parseCuratorResponse(response);
    expect(files.get("code.md")).toContain("const x = 1;");
    expect(files.get("code.md")).toContain("// <not a tag>");
  });
});

// ---------------------------------------------------------------------------
// buildTier3Prompt
// ---------------------------------------------------------------------------

describe("buildTier3Prompt", () => {
  test("includes all sections", () => {
    const prompt = buildTier3Prompt(
      "User: Hello\n\nAssistant: Hi there",
      "# Recent",
      "# Tasks",
      "# Context",
      5,
    );
    expect(prompt).toContain("short-term memory (Tier 3)");
    expect(prompt).toContain("last 5 sessions");
    expect(prompt).toContain("<current_recent>");
    expect(prompt).toContain("# Recent");
    expect(prompt).toContain("<current_tasks>");
    expect(prompt).toContain("# Tasks");
    expect(prompt).toContain("<current_context>");
    expect(prompt).toContain("# Context");
    expect(prompt).toContain("<transcript>");
    expect(prompt).toContain("User: Hello");
  });

  test("handles empty current content", () => {
    const prompt = buildTier3Prompt("transcript", "", "", "", 3);
    expect(prompt).toContain("(empty)");
  });

  test("recency window changes with maxRecentSessions", () => {
    const prompt3 = buildTier3Prompt("t", "r", "t", "c", 3);
    expect(prompt3).toContain("last 3 sessions");

    const prompt10 = buildTier3Prompt("t", "r", "t", "c", 10);
    expect(prompt10).toContain("last 10 sessions");
  });

  test("includes transcript in prompt", () => {
    const prompt = buildTier3Prompt(
      "User: I finished the Jarvis project\n\nAssistant: Congratulations!",
      "", "", "", 5,
    );
    expect(prompt).toContain("finished the Jarvis project");
    expect(prompt).toContain("Congratulations!");
  });
});

// ---------------------------------------------------------------------------
// buildTier2Prompt
// ---------------------------------------------------------------------------

describe("buildTier2Prompt", () => {
  test("includes all sections", () => {
    const prompt = buildTier2Prompt(
      "User: Working on Jarvis\n\nAssistant: Building the curator system",
      "# Projects",
      "# Skills",
      "# Focus",
    );
    expect(prompt).toContain("medium-term memory (Tier 2)");
    expect(prompt).toContain("<current_projects>");
    expect(prompt).toContain("# Projects");
    expect(prompt).toContain("<current_skills>");
    expect(prompt).toContain("# Skills");
    expect(prompt).toContain("<current_focus>");
    expect(prompt).toContain("# Focus");
    expect(prompt).toContain("<transcript>");
    expect(prompt).toContain("Working on Jarvis");
  });

  test("handles empty current content", () => {
    const prompt = buildTier2Prompt("transcript", "", "", "");
    expect(prompt).toContain("(empty)");
  });

  test("includes conservation guidelines", () => {
    const prompt = buildTier2Prompt("t", "p", "s", "f");
    expect(prompt).toContain("Be conservative");
    expect(prompt).toContain("Preserve existing content");
  });
});
