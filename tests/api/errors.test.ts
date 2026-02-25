import { describe, expect, it, mock, afterEach } from "bun:test";
import { ClaudeClient } from "../../src/api/client.ts";
import { ClaudeApiError } from "../../src/api/types.ts";
import type { JarvisConfig } from "../../src/config.ts";
import { DEFAULT_CONFIG } from "../../src/config.ts";

function makeConfig(overrides: Partial<JarvisConfig> = {}): JarvisConfig {
  return {
    ...DEFAULT_CONFIG,
    authToken: "sk-ant-oat01-test-token-1234567890",
    apiBaseUrl: "https://test.api.anthropic.com",
    ...overrides,
  };
}

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("ClaudeClient error handling", () => {
  it("throws ClaudeApiError with parsed error body on 401", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            type: "error",
            error: { type: "authentication_error", message: "Invalid API key" },
          }),
          { status: 401, statusText: "Unauthorized" },
        ),
      ),
    ) as unknown as typeof fetch;

    const client = new ClaudeClient(makeConfig());
    try {
      await client.call({ messages: [{ role: "user", content: "hi" }] });
      expect(true).toBe(false); // Should not reach here
    } catch (err) {
      expect(err).toBeInstanceOf(ClaudeApiError);
      const apiErr = err as ClaudeApiError;
      expect(apiErr.status).toBe(401);
      expect(apiErr.errorType).toBe("authentication_error");
      expect(apiErr.message).toBe("Invalid API key");
      expect(apiErr.isAuth).toBe(true);
    }
  });

  it("throws ClaudeApiError on 429 rate limit", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            type: "error",
            error: { type: "rate_limit_error", message: "Rate limit exceeded" },
          }),
          { status: 429, statusText: "Too Many Requests" },
        ),
      ),
    ) as unknown as typeof fetch;

    const client = new ClaudeClient(makeConfig());
    try {
      await client.call({ messages: [{ role: "user", content: "hi" }] });
      expect(true).toBe(false);
    } catch (err) {
      const apiErr = err as ClaudeApiError;
      expect(apiErr.status).toBe(429);
      expect(apiErr.isRateLimit).toBe(true);
    }
  });

  it("throws ClaudeApiError on 529 overloaded", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            type: "error",
            error: { type: "overloaded_error", message: "API is temporarily overloaded" },
          }),
          { status: 529, statusText: "Overloaded" },
        ),
      ),
    ) as unknown as typeof fetch;

    const client = new ClaudeClient(makeConfig());
    try {
      await client.call({ messages: [{ role: "user", content: "hi" }] });
      expect(true).toBe(false);
    } catch (err) {
      const apiErr = err as ClaudeApiError;
      expect(apiErr.status).toBe(529);
      expect(apiErr.isOverloaded).toBe(true);
    }
  });

  it("handles non-JSON error response gracefully", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response("Bad Gateway", { status: 502, statusText: "Bad Gateway" }),
      ),
    ) as unknown as typeof fetch;

    const client = new ClaudeClient(makeConfig());
    try {
      await client.call({ messages: [{ role: "user", content: "hi" }] });
      expect(true).toBe(false);
    } catch (err) {
      const apiErr = err as ClaudeApiError;
      expect(apiErr.status).toBe(502);
      expect(apiErr.message).toBe("502 Bad Gateway");
    }
  });

  it("throws ClaudeApiError on network failure", async () => {
    globalThis.fetch = mock(() =>
      Promise.reject(new Error("ECONNREFUSED")),
    ) as unknown as typeof fetch;

    const client = new ClaudeClient(makeConfig());
    try {
      await client.call({ messages: [{ role: "user", content: "hi" }] });
      expect(true).toBe(false);
    } catch (err) {
      const apiErr = err as ClaudeApiError;
      expect(apiErr.status).toBe(0);
      expect(apiErr.errorType).toBe("network_error");
      expect(apiErr.message).toContain("ECONNREFUSED");
    }
  });

  it("successful call returns parsed ClaudeResponse", async () => {
    const mockResponse = {
      id: "msg_01",
      type: "message",
      role: "assistant",
      content: [{ type: "text", text: "Hello!" }],
      model: "claude-opus-4-6",
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 5 },
    };

    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify(mockResponse), { status: 200 })),
    ) as unknown as typeof fetch;

    const client = new ClaudeClient(makeConfig());
    const response = await client.call({ messages: [{ role: "user", content: "hi" }] });

    expect(response.id).toBe("msg_01");
    expect(response.content[0]!.type).toBe("text");
    expect(response.stop_reason).toBe("end_turn");
  });

  it("sends request to correct URL", async () => {
    let capturedUrl = "";
    globalThis.fetch = mock((url: string | URL | Request) => {
      capturedUrl = typeof url === "string" ? url : url.toString();
      return Promise.resolve(
        new Response(JSON.stringify({ id: "msg_01", type: "message", role: "assistant", content: [], model: "claude-opus-4-6", stop_reason: "end_turn", usage: { input_tokens: 0, output_tokens: 0 } }), { status: 200 }),
      );
    }) as unknown as typeof fetch;

    const client = new ClaudeClient(makeConfig({ apiBaseUrl: "https://custom.api.com" }));
    await client.call({ messages: [{ role: "user", content: "hi" }] });

    expect(capturedUrl).toBe("https://custom.api.com/v1/messages");
  });

  it("stream throws on missing response body", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(null, { status: 200 })),
    ) as unknown as typeof fetch;

    const client = new ClaudeClient(makeConfig());

    try {
      for await (const _event of client.stream({ messages: [{ role: "user", content: "hi" }] })) {
        // Should not reach here
      }
      expect(true).toBe(false);
    } catch (err) {
      const apiErr = err as ClaudeApiError;
      expect(apiErr.errorType).toBe("no_body");
    }
  });

  it("captures request-id header from error responses", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            type: "error",
            error: { type: "overloaded_error", message: "API is temporarily overloaded" },
          }),
          {
            status: 529,
            statusText: "Overloaded",
            headers: { "request-id": "req_011CSHoEeqs5C35K2UUqR7Fy" },
          },
        ),
      ),
    ) as unknown as typeof fetch;

    const client = new ClaudeClient(makeConfig());
    try {
      await client.call({ messages: [{ role: "user", content: "hi" }] });
      expect(true).toBe(false);
    } catch (err) {
      const apiErr = err as ClaudeApiError;
      expect(apiErr.requestId).toBe("req_011CSHoEeqs5C35K2UUqR7Fy");
    }
  });

  it("throws timeout ClaudeApiError when request exceeds requestTimeoutMs", async () => {
    // Simulate a fetch that hangs until aborted (respects the signal)
    globalThis.fetch = mock((_url: string | URL | Request, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted.", "AbortError"));
        });
      }),
    ) as unknown as typeof fetch;

    const client = new ClaudeClient(makeConfig({ requestTimeoutMs: 100 }));
    try {
      await client.call({ messages: [{ role: "user", content: "hi" }] });
      expect(true).toBe(false); // Should not reach here
    } catch (err) {
      const apiErr = err as ClaudeApiError;
      expect(apiErr.status).toBe(0);
      expect(apiErr.errorType).toBe("timeout");
      expect(apiErr.message).toContain("100ms");
    }
  });

  it("requestId is undefined when header is absent and body lacks it", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            type: "error",
            error: { type: "rate_limit_error", message: "Rate limit exceeded" },
          }),
          { status: 429, statusText: "Too Many Requests" },
        ),
      ),
    ) as unknown as typeof fetch;

    const client = new ClaudeClient(makeConfig());
    try {
      await client.call({ messages: [{ role: "user", content: "hi" }] });
      expect(true).toBe(false);
    } catch (err) {
      const apiErr = err as ClaudeApiError;
      expect(apiErr.requestId).toBeUndefined();
    }
  });

  it("extracts request_id from error JSON body when header is absent", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            type: "error",
            error: { type: "api_error", message: "Internal server error" },
            request_id: "req_from_body_abc123",
          }),
          { status: 500, statusText: "Internal Server Error" },
        ),
      ),
    ) as unknown as typeof fetch;

    const client = new ClaudeClient(makeConfig());
    try {
      await client.call({ messages: [{ role: "user", content: "hi" }] });
      expect(true).toBe(false);
    } catch (err) {
      const apiErr = err as ClaudeApiError;
      expect(apiErr.requestId).toBe("req_from_body_abc123");
    }
  });

  it("prefers request-id header over JSON body request_id", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            type: "error",
            error: { type: "api_error", message: "Internal server error" },
            request_id: "req_from_body",
          }),
          {
            status: 500,
            statusText: "Internal Server Error",
            headers: { "request-id": "req_from_header" },
          },
        ),
      ),
    ) as unknown as typeof fetch;

    const client = new ClaudeClient(makeConfig());
    try {
      await client.call({ messages: [{ role: "user", content: "hi" }] });
      expect(true).toBe(false);
    } catch (err) {
      const apiErr = err as ClaudeApiError;
      expect(apiErr.requestId).toBe("req_from_header");
    }
  });
});
