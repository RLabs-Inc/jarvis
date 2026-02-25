import { describe, test, expect, afterAll } from "bun:test";
import { executeTool, executeToolForApi } from "../../src/tools/engine.ts";
import type { ToolUseBlock } from "../../src/api/types.ts";
import { existsSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TEST_DIR = join(tmpdir(), `jarvis-test-engine-${Date.now()}`);

afterAll(() => {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// Helper to build a ToolUseBlock
// ---------------------------------------------------------------------------

function toolUse(name: string, input: Record<string, unknown>): ToolUseBlock {
  return { type: "tool_use", id: `test_${name}_${Date.now()}`, name, input };
}

// ---------------------------------------------------------------------------
// Tool Routing
// ---------------------------------------------------------------------------

describe("executeTool routing", () => {
  test("routes bash tool to shell execution", async () => {
    const result = await executeTool(toolUse("bash", { command: "echo routed" }));
    expect(result.content).toContain("routed");
    expect(result.is_error).toBe(false);
  });

  test("routes read_file tool", async () => {
    // First create a file to read
    const path = join(TEST_DIR, "engine-read.txt");
    await executeTool(toolUse("write_file", { path, content: "engine test" }));
    const result = await executeTool(toolUse("read_file", { path }));
    expect(result.content).toBe("engine test");
    expect(result.is_error).toBe(false);
  });

  test("routes write_file tool", async () => {
    const path = join(TEST_DIR, "engine-write.txt");
    const result = await executeTool(toolUse("write_file", { path, content: "hello" }));
    expect(result.content).toContain(path);
    expect(result.is_error).toBe(false);
    expect(readFileSync(path, "utf-8")).toBe("hello");
  });

  test("routes unknown tool to error", async () => {
    const result = await executeTool(toolUse("nonexistent_tool", {}));
    expect(result.content).toContain("Unknown tool");
    expect(result.is_error).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Error Handling
// ---------------------------------------------------------------------------

describe("executeTool error handling", () => {
  test("returns error for failed bash command", async () => {
    const result = await executeTool(toolUse("bash", { command: "exit 1" }));
    expect(result.is_error).toBe(true);
  });

  test("returns error for missing required fields", async () => {
    const result = await executeTool(toolUse("bash", {}));
    expect(result.content).toContain("Missing");
    expect(result.is_error).toBe(true);
  });

  test("returns error for read_file on nonexistent path", async () => {
    const result = await executeTool(
      toolUse("read_file", { path: "/nonexistent/path/file.txt" }),
    );
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("error");
  });

  test("catches unexpected exceptions", async () => {
    // read_file with no path should produce a handled error
    const result = await executeTool(toolUse("read_file", {}));
    expect(result.is_error).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// executeToolForApi
// ---------------------------------------------------------------------------

describe("executeToolForApi", () => {
  test("returns ToolResultBlock with correct tool_use_id", async () => {
    const tu = toolUse("bash", { command: "echo api-test" });
    const result = await executeToolForApi(tu);

    expect(result.type).toBe("tool_result");
    expect(result.tool_use_id).toBe(tu.id);
    expect(result.content).toContain("api-test");
  });

  test("sets is_error on ToolResultBlock for failures", async () => {
    const tu = toolUse("bash", { command: "exit 42" });
    const result = await executeToolForApi(tu);

    expect(result.type).toBe("tool_result");
    expect(result.is_error).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Interactive Bash via Engine
// ---------------------------------------------------------------------------

describe("bash interactive mode via engine", () => {
  test("executes in interactive mode when flag is set", async () => {
    const result = await executeTool(
      toolUse("bash", { command: "echo pty-engine", interactive: true }),
    );
    expect(result.content).toContain("pty-engine");
    expect(result.is_error).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Web Fetch via Engine
// ---------------------------------------------------------------------------

describe("web_fetch via engine", () => {
  test("fetches a URL", async () => {
    const result = await executeTool(
      toolUse("web_fetch", { url: "https://httpbin.org/get" }),
    );
    expect(result.content).toContain("200");
    expect(result.is_error).toBe(false);
  });

  test("returns error for missing url", async () => {
    const result = await executeTool(toolUse("web_fetch", {}));
    expect(result.content).toContain("Missing");
    expect(result.is_error).toBe(true);
  });

  test("times out on slow requests", async () => {
    // httpbin /delay/10 sleeps 10 seconds — with 500ms timeout it should abort
    const result = await executeTool(
      toolUse("web_fetch", { url: "https://httpbin.org/delay/10", timeout_ms: 500 }),
    );
    expect(result.content).toContain("timed out");
    expect(result.is_error).toBe(true);
  });

  test("supports custom timeout_ms parameter", async () => {
    // A fast URL with generous timeout should succeed
    const result = await executeTool(
      toolUse("web_fetch", { url: "https://httpbin.org/get", timeout_ms: 15000 }),
    );
    expect(result.content).toContain("200");
    expect(result.is_error).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Cron via Engine
// ---------------------------------------------------------------------------

describe("cron_manage via engine", () => {
  test("lists cron entries", async () => {
    const result = await executeTool(
      toolUse("cron_manage", { action: "list" }),
    );
    // Either "No Jarvis cron entries" or a list — both are valid
    expect(result.is_error).toBe(false);
  });

  test("returns error for missing action", async () => {
    const result = await executeTool(toolUse("cron_manage", {}));
    expect(result.content).toContain("Missing");
    expect(result.is_error).toBe(true);
  });

  test("returns error for unknown action", async () => {
    const result = await executeTool(
      toolUse("cron_manage", { action: "invalid" }),
    );
    expect(result.content).toContain("Unknown cron action");
    expect(result.is_error).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// SSH via Engine
// ---------------------------------------------------------------------------

describe("ssh_exec via engine", () => {
  test("returns error for missing host", async () => {
    const result = await executeTool(
      toolUse("ssh_exec", { command: "echo test" }),
    );
    expect(result.content).toContain("Missing");
    expect(result.is_error).toBe(true);
  });

  test("returns error for missing command", async () => {
    const result = await executeTool(
      toolUse("ssh_exec", { host: "localhost" }),
    );
    expect(result.content).toContain("Missing");
    expect(result.is_error).toBe(true);
  });
});
