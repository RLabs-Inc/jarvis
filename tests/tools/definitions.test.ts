import { describe, test, expect } from "bun:test";
import { CORE_TOOLS, TOOL_NAMES } from "../../src/tools/definitions.ts";
import type { ToolDefinition, ToolResultBlock } from "../../src/api/types.ts";

describe("CORE_TOOLS", () => {
  test("defines exactly 6 tools", () => {
    expect(CORE_TOOLS).toHaveLength(6);
  });

  test("all tools have required fields", () => {
    for (const tool of CORE_TOOLS) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.input_schema).toBeTruthy();
      expect(tool.input_schema["type"]).toBe("object");
      expect(tool.input_schema["properties"]).toBeTruthy();
    }
  });

  test("tool names match TOOL_NAMES constants", () => {
    const names = CORE_TOOLS.map((t) => t.name);
    expect(names).toContain(TOOL_NAMES.bash);
    expect(names).toContain(TOOL_NAMES.read_file);
    expect(names).toContain(TOOL_NAMES.write_file);
    expect(names).toContain(TOOL_NAMES.ssh_exec);
    expect(names).toContain(TOOL_NAMES.cron_manage);
    expect(names).toContain(TOOL_NAMES.web_fetch);
  });

  test("no spawn_agent tool — Claude Code IS the agent system", () => {
    const names = CORE_TOOLS.map((t) => t.name);
    expect(names).not.toContain("spawn_agent");
  });

  test("bash tool has interactive flag", () => {
    const bash = CORE_TOOLS.find((t) => t.name === TOOL_NAMES.bash);
    expect(bash).toBeTruthy();
    const props = bash!.input_schema["properties"] as Record<string, unknown>;
    expect(props["interactive"]).toBeTruthy();
  });

  test("all tools have required fields specified", () => {
    for (const tool of CORE_TOOLS) {
      const required = tool.input_schema["required"] as string[];
      expect(Array.isArray(required)).toBe(true);
      expect(required.length).toBeGreaterThan(0);
    }
  });

  test("all tool descriptions are detailed (3+ sentences per API best practices)", () => {
    for (const tool of CORE_TOOLS) {
      // Count sentence-ending punctuation as a rough proxy for description richness
      const sentences = tool.description.split(/[.!]/).filter((s) => s.trim().length > 0);
      expect(sentences.length).toBeGreaterThanOrEqual(3);
    }
  });

  test("web_fetch tool exposes timeout_ms parameter", () => {
    const webFetch = CORE_TOOLS.find((t) => t.name === TOOL_NAMES.web_fetch);
    expect(webFetch).toBeTruthy();
    const props = webFetch!.input_schema["properties"] as Record<string, unknown>;
    expect(props["timeout_ms"]).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// API Type Extensions (compile-time + runtime verification)
// ---------------------------------------------------------------------------

describe("API type extensions", () => {
  test("ToolDefinition accepts input_examples", () => {
    const def: ToolDefinition = {
      name: "test_tool",
      description: "A test tool",
      input_schema: { type: "object", properties: { x: { type: "number" } }, required: ["x"] },
      input_examples: [{ x: 42 }, { x: 0 }],
    };
    expect(def.input_examples).toHaveLength(2);
    expect(def.input_examples![0]).toEqual({ x: 42 });
  });

  test("ToolDefinition works without input_examples (backwards compatible)", () => {
    const def: ToolDefinition = {
      name: "test_tool",
      description: "A test tool",
      input_schema: { type: "object", properties: {}, required: [] },
    };
    expect(def.input_examples).toBeUndefined();
  });

  test("ToolResultBlock accepts cache_control", () => {
    const block: ToolResultBlock = {
      type: "tool_result",
      tool_use_id: "test_123",
      content: "result data",
      cache_control: { type: "ephemeral", ttl: "5m" },
    };
    expect(block.cache_control).toEqual({ type: "ephemeral", ttl: "5m" });
  });

  test("ToolResultBlock works without cache_control (backwards compatible)", () => {
    const block: ToolResultBlock = {
      type: "tool_result",
      tool_use_id: "test_123",
      content: "result data",
    };
    expect(block.cache_control).toBeUndefined();
  });
});
