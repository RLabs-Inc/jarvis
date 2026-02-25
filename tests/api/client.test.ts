import { describe, expect, it } from "bun:test";
import { buildRequest } from "../../src/api/client.ts";
import type { JarvisConfig } from "../../src/config.ts";
import { DEFAULT_CONFIG } from "../../src/config.ts";
import { ClaudeApiError } from "../../src/api/types.ts";
import type { SystemBlock } from "../../src/api/types.ts";

function makeConfig(overrides: Partial<JarvisConfig> = {}): JarvisConfig {
  return { ...DEFAULT_CONFIG, authToken: "sk-ant-oat01-test-token-1234567890", ...overrides };
}

describe("buildRequest", () => {
  it("uses config model when no override", () => {
    const config = makeConfig({ model: "claude-opus-4-6" });
    const req = buildRequest({ messages: [{ role: "user", content: "hello" }] }, config);
    expect(req.model).toBe("claude-opus-4-6");
  });

  it("option model overrides config model", () => {
    const config = makeConfig({ model: "claude-opus-4-6" });
    const req = buildRequest(
      { model: "claude-haiku-4-5-20251001", messages: [{ role: "user", content: "hello" }] },
      config,
    );
    expect(req.model).toBe("claude-haiku-4-5-20251001");
  });

  it("defaults max_tokens to 32768", () => {
    const req = buildRequest({ messages: [{ role: "user", content: "hi" }] }, makeConfig());
    expect(req.max_tokens).toBe(32768);
  });

  it("custom maxTokens overrides default", () => {
    const req = buildRequest(
      { maxTokens: 4096, messages: [{ role: "user", content: "hi" }] },
      makeConfig(),
    );
    expect(req.max_tokens).toBe(4096);
  });

  it("includes system blocks with cache_control breakpoints", () => {
    const system: SystemBlock[] = [
      { type: "text", text: "tier1 identity content" },
      { type: "text", text: "tier1 tools", cache_control: { type: "ephemeral", ttl: "1h" } },
      { type: "text", text: "tier2 content", cache_control: { type: "ephemeral", ttl: "1h" } },
      { type: "text", text: "tier3 content", cache_control: { type: "ephemeral", ttl: "5m" } },
    ];

    const req = buildRequest(
      { system, messages: [{ role: "user", content: "hello" }] },
      makeConfig(),
    );

    expect(req.system).toBeDefined();
    expect(req.system!.length).toBe(4);
    expect(req.system![0]!.cache_control).toBeUndefined();
    expect(req.system![1]!.cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
    expect(req.system![2]!.cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
    expect(req.system![3]!.cache_control).toEqual({ type: "ephemeral", ttl: "5m" });
  });

  it("omits system when empty", () => {
    const req = buildRequest(
      { system: [], messages: [{ role: "user", content: "hi" }] },
      makeConfig(),
    );
    expect(req.system).toBeUndefined();
  });

  it("includes tool definitions when provided", () => {
    const tools = [
      {
        name: "bash",
        description: "Execute a shell command",
        input_schema: {
          type: "object",
          properties: { command: { type: "string" } },
          required: ["command"],
        },
      },
    ];

    const req = buildRequest(
      { tools, messages: [{ role: "user", content: "run ls" }] },
      makeConfig(),
    );

    expect(req.tools).toBeDefined();
    expect(req.tools!.length).toBe(1);
    expect(req.tools![0]!.name).toBe("bash");
  });

  it("omits tools when empty", () => {
    const req = buildRequest(
      { tools: [], messages: [{ role: "user", content: "hi" }] },
      makeConfig(),
    );
    expect(req.tools).toBeUndefined();
  });

  it("passes messages through unchanged", () => {
    const messages = [
      { role: "user" as const, content: "hello" },
      { role: "assistant" as const, content: "hi there" },
      { role: "user" as const, content: "how are you?" },
    ];

    const req = buildRequest({ messages }, makeConfig());
    expect(req.messages).toEqual(messages);
  });

  it("sets stream flag when specified", () => {
    const req = buildRequest(
      { stream: true, messages: [{ role: "user", content: "hi" }] },
      makeConfig(),
    );
    expect(req.stream).toBe(true);
  });
});

describe("ClaudeApiError", () => {
  it("isRateLimit returns true for 429", () => {
    const err = new ClaudeApiError(429, "rate_limit_error", "Too many requests");
    expect(err.isRateLimit).toBe(true);
    expect(err.isAuth).toBe(false);
  });

  it("isAuth returns true for 401", () => {
    const err = new ClaudeApiError(401, "authentication_error", "Invalid token");
    expect(err.isAuth).toBe(true);
    expect(err.isRateLimit).toBe(false);
  });

  it("isAuth returns true for 403", () => {
    const err = new ClaudeApiError(403, "permission_error", "Forbidden");
    expect(err.isAuth).toBe(true);
  });

  it("isOverloaded returns true for 529", () => {
    const err = new ClaudeApiError(529, "overloaded_error", "API is overloaded");
    expect(err.isOverloaded).toBe(true);
  });

  it("preserves status, errorType, and message", () => {
    const err = new ClaudeApiError(500, "server_error", "Internal error");
    expect(err.status).toBe(500);
    expect(err.errorType).toBe("server_error");
    expect(err.message).toBe("Internal error");
    expect(err.name).toBe("ClaudeApiError");
  });

  it("stores requestId when provided", () => {
    const err = new ClaudeApiError(500, "server_error", "Internal error", "req_abc123");
    expect(err.requestId).toBe("req_abc123");
  });

  it("requestId is undefined when not provided", () => {
    const err = new ClaudeApiError(500, "server_error", "Internal error");
    expect(err.requestId).toBeUndefined();
  });

  it("isServerError returns true for 500", () => {
    const err = new ClaudeApiError(500, "api_error", "Internal server error");
    expect(err.isServerError).toBe(true);
    expect(err.isRateLimit).toBe(false);
    expect(err.isOverloaded).toBe(false);
  });
});
